import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LEGAL_VERSION } from "@/lib/legal";
import { effectivePrice, toDiscountInput } from "@/lib/pricing/effective-price";
import { createPaymentLink, getTochkaConfig } from "@/lib/tochka";
import { cancelUnpaidOrder, placeOnlineOrder } from "@/lib/payments/online-order";
import { reserveForOrder, StockError } from "@/lib/stock/movements";
import { normalizeRuPhone, OzonError } from "@/lib/delivery/ozon";
import { allowRequest, checkBuyer, getCheckoutOzon, isLimited, quoteCart, recordHit } from "@/lib/delivery/ozon-service";
import { ozonDeliverySchema, personNameSchema } from "@/lib/delivery/ozon-http";
import type { OzonOrderRequest } from "@/lib/delivery/ozon-orders";
import { rememberCheckout } from "@/lib/checkout-profile";
import { customerDeliveryPrice } from "@/lib/delivery/free-delivery";
import { applyBundles } from "@/lib/bundles";

const checkoutSchema = z.object({
  customerName: z.string().min(2),
  // Те же имя и фамилия раздельно — для профиля (форма спрашивает их один раз). Необязательно.
  customerNameParts: personNameSchema.optional(),
  customerEmail: z.string().email(),
  customerPhone: z.string().min(5),
  deliveryCity: z.string().min(2),
  deliveryAddress: z.string().min(5),
  comment: z.string().optional(),
  // Оферта — единственное обязательное подтверждение. Согласие на ПДн и рекламное
  // согласие — отдельные необязательные поля, не условие покупки (ст. 9 152-ФЗ, ст. 18 38-ФЗ).
  offerAccepted: z.literal(true),
  pdnConsent: z.boolean().optional(),
  adsConsent: z.boolean().optional(),
  items: z
    .array(
      z.object({
        productId: z.string(),
        quantity: z.number().int().positive().max(100),
      }),
    )
    .min(1)
    .max(50),
  // Доставка Ozon (необязательно). Без неё заказ оформляется как раньше — адрес свободным текстом.
  delivery: ozonDeliverySchema.optional(),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const session = await getServerSession(authOptions);

  // Дубли одного SKU складываем: иначе одну позицию можно «разбить» и обойти лимит остатка.
  const wanted = new Map<string, number>();
  for (const i of data.items) wanted.set(i.productId, (wanted.get(i.productId) ?? 0) + i.quantity);

  // include: discount — итоговая цена ВСЕГДА пересчитывается сервером через
  // effectivePrice(), а не берётся из клиента (клиент вообще не может
  // передать price — см. checkoutSchema выше, там его нет). Единственный
  // authoritative источник: Product.price + активный Discount из БД.
  // Продаются только опубликованные активные товары с положительной ценой.
  const products = await prisma.product.findMany({
    where: { id: { in: [...wanted.keys()] }, status: "published", isActive: true, price: { gt: 0 } },
    include: { discount: true },
  });

  if (products.length !== wanted.size) {
    return NextResponse.json({ error: "Некоторые товары недоступны" }, { status: 400 });
  }

  const orderItems = products.map((product) => {
    const priced = effectivePrice(product.price, toDiscountInput(product.discount));
    return {
      productId: product.id,
      title: product.title,
      price: priced.effectivePrice,
      quantity: wanted.get(product.id)!,
    };
  });

  const itemsAmount = orderItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  if (itemsAmount <= 0 || orderItems.some((i) => i.price <= 0)) {
    return NextResponse.json({ error: "Некорректная сумма заказа" }, { status: 400 });
  }
  // Наборы со скидкой — по ценам из БД, не от клиента. Сумма товаров дальше (оплата, порог бесплатной
  // доставки) — уже со скидкой за наборы.
  const slugById = new Map(products.map((p) => [p.id, p.slug]));
  const bundleResult = applyBundles(orderItems.map((i) => ({ slug: slugById.get(i.productId)!, price: i.price, quantity: i.quantity })));
  const goodsAmount = itemsAmount - bundleResult.discount;

  const tochka = getTochkaConfig();

  // Доставка Ozon: цену и срок считает сервер (v2/delivery/checkout) — сумма заказа сверяется с банком,
  // поэтому цифрам из браузера не верим. Наложенного платежа у Ozon нет — только с онлайн-оплатой.
  let ozonDelivery: { price: number; maxDate: Date; method: string; request: OzonOrderRequest; quote: unknown } | null = null;
  if (data.delivery) {
    const ozon = getCheckoutOzon();
    if (!ozon || !tochka) {
      return NextResponse.json({ error: "Доставка Ozon сейчас недоступна" }, { status: 400 });
    }
    const d = data.delivery;
    const phone = normalizeRuPhone(d.recipient.phone ?? data.customerPhone);
    if (!phone) {
      return NextResponse.json({ error: "Для доставки Ozon нужен мобильный номер РФ" }, { status: 400 });
    }
    // Курьер при оформлении закрыт: координаты приходят от клиента и не сверяются с адресом —
    // цену можно было бы занизить «близкими» координатами при далёком адресе. Откроется вместе
    // с серверным геокодером (адрес -> координаты). Расчёт для показа (/quote) курьера умеет.
    if (d.destination.type === "COURIER") {
      return NextResponse.json({ error: "Курьерская доставка Ozon пока недоступна, выберите пункт выдачи" }, { status: 400 });
    }
    // Каждая попытка — несколько запросов к Ozon с нашим ключом и проверка номера: ограничиваем частоту
    // с адреса и отдельно по номеру — не больше 5 ответов «нет аккаунта Ozon» в час, чтобы этот ответ не
    // стал инструментом перебора. Засчитываются только неудачи: чужие попытки не заблокируют настоящего
    // владельца номера, у которого аккаунт есть. Остаточный риск — см. docs/ozon-delivery.md.
    const phoneKey = `ozon-no-account:${phone}`;
    if (!allowRequest(req, "ozon-order", 10) || isLimited(phoneKey, 5)) {
      return NextResponse.json({ error: "Слишком много попыток, попробуйте позже" }, { status: 429 });
    }
    let quote;
    try {
      // Получить заказ Ozon можно только с аккаунтом Ozon на этом номере. Проверяем ДО оплаты и только
      // номер из самого заказа (публичной проверки произвольного номера нет — это был бы оракул аккаунтов).
      if (!(await checkBuyer(ozon, phone)).possible) {
        recordHit(phoneKey, 60 * 60_000);
        return NextResponse.json(
          { error: "Для получения в Ozon нужен аккаунт Ozon с этим номером телефона", reason: "NO_OZON_ACCOUNT" },
          { status: 409 },
        );
      }
      quote = await quoteCart(ozon, { lines: orderItems, destination: d.destination, phone });
    } catch (err) {
      if (!(err instanceof OzonError)) throw err;
      console.error("orders: расчёт доставки Ozon не удался", err.message);
      return NextResponse.json({ error: "Не удалось рассчитать доставку, попробуйте ещё раз" }, { status: 502 });
    }
    if (!quote.available) {
      return NextResponse.json({ error: "Ozon не доставит этот заказ по выбранному адресу", reason: quote.reason }, { status: 409 });
    }
    ozonDelivery = {
      // От порога бесплатной доставки покупатель за неё не платит; тариф Ozon остаётся в quote.
      price: customerDeliveryPrice(goodsAmount, quote.priceKopecks),
      maxDate: new Date(quote.maxDate),
      method: d.destination.type === "PVZ" ? "OZON_PVZ" : "OZON_COURIER",
      request: { destination: d.destination, recipient: { ...d.recipient, phone }, ...(d.courier ? { courier: d.courier } : {}) },
      quote,
    };
  }
  const totalAmount = goodsAmount + (ozonDelivery?.price ?? 0);

  // Суффикс: два заказа в одну миллисекунду иначе получают один номер, и второй падает на unique.
  // Без дефиса — номер проверяется как ^V-[A-Z0-9]{4,20}$ (/api/orders/[number]/payment).
  const number = `V-${Date.now().toString(36).toUpperCase()}${randomBytes(2).toString("hex").toUpperCase()}`;
  // Публичный адрес для возврата из банка. NEXTAUTH_URL читается сервером при запуске;
  // NEXT_PUBLIC_* Next.js вшивает при сборке (на бою там был внутренний 127.0.0.1).
  const appUrl = (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin).replace(/\/$/, "");
  const now = new Date().toISOString();
  const orderData = {
    number,
    userId: session?.user ? (session.user as { id: string }).id : undefined,
    customerName: data.customerName,
    customerEmail: data.customerEmail,
    customerPhone: data.customerPhone,
    deliveryCity: data.deliveryCity,
    deliveryAddress: data.deliveryAddress,
    comment: data.comment,
    offerAcceptedAt: now,
    pdnConsentAt: data.pdnConsent ? now : null,
    adsConsentAt: data.adsConsent ? now : null,
    consentSource: "WEB_CHECKOUT",
    legalVersion: LEGAL_VERSION,
    totalAmount,
    bundleDiscount: bundleResult.discount,
    bundles: bundleResult.applied.length
      ? bundleResult.applied.map((a) => `${a.title} −${a.percent}%: −${a.discount / 100} ₽`).join("; ")
      : null,
    ...(ozonDelivery
      ? {
          deliveryMethod: ozonDelivery.method,
          deliveryPrice: ozonDelivery.price,
          deliveryMaxDate: ozonDelivery.maxDate,
          // Заказ в Ozon — только после оплаты (tochka-runtime onOutcome); здесь лишь то, что для него нужно.
          ozon: {
            create: {
              deliveryType: ozonDelivery.request.destination.type,
              request: ozonDelivery.request as unknown as Prisma.InputJsonValue,
              quote: ozonDelivery.quote as Prisma.InputJsonValue,
            },
          },
        }
      : {}),
  };

  // Зарегистрированному покупателю — данные заказа в профиль, чтобы в следующий раз не вводить их снова.
  // Только после того, как заказ создан; сбой профиля заказ не ломает.
  const remember = async () => {
    if (!orderData.userId) return;
    try {
      await rememberCheckout(prisma, orderData.userId, {
        name: data.customerNameParts,
        phone: data.customerPhone,
        ozonPointId: data.delivery?.destination.type === "PVZ" ? data.delivery.destination.mapPointId : undefined,
      });
    } catch (err) {
      console.error("orders: профиль покупателя не обновлён", err instanceof Error ? err.message : err);
    }
  };

  // Без эквайринга: заказ NEW (оплата при получении) + резерв остатка одной транзакцией.
  if (!tochka) {
    try {
      const order = await prisma.$transaction(async (tx) => {
        const created = await tx.order.create({ data: { ...orderData, status: "NEW", items: { create: orderItems } } });
        await reserveForOrder(tx, {
          orderId: created.id,
          items: orderItems.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          source: "SITE_ORDER",
        });
        return created;
      });
      await remember();
      return NextResponse.json({ orderId: order.id, orderNumber: order.number, paymentUrl: null });
    } catch (err) {
      if (err instanceof StockError && err.code === "OUT_OF_STOCK") {
        return NextResponse.json({ error: "Недостаточно товара на складе", outOfStock: err.details }, { status: 409 });
      }
      throw err;
    }
  }

  // Онлайн-оплата через Точку: заказ + резерв одной транзакцией, ссылка банка, 10 минут на оплату.
  let order;
  try {
    order = await placeOnlineOrder(prisma, orderData, orderItems);
  } catch (err) {
    if (err instanceof StockError && err.code === "OUT_OF_STOCK") {
      return NextResponse.json({ error: "Недостаточно товара на складе", outOfStock: err.details }, { status: 409 });
    }
    throw err;
  }
  await remember();
  const payPage = `/checkout/pay/${encodeURIComponent(order.number)}`;
  try {
    const link = await createPaymentLink(tochka, {
      amountKopecks: totalAmount,
      purpose: `Оплата заказа ${order.number} в магазине VIA LABOTE`,
      successUrl: `${appUrl}${payPage}`,
      failUrl: `${appUrl}${payPage}`,
    });
    await prisma.order.update({ where: { id: order.id }, data: { paymentId: link.operationId, paymentUrl: link.paymentLink } });
    return NextResponse.json({
      orderId: order.id,
      orderNumber: order.number,
      paymentUrl: null,
      payPage,
      ...(ozonDelivery ? { delivery: { priceKopecks: ozonDelivery.price, maxDate: ozonDelivery.maxDate.toISOString() } } : {}),
    });
  } catch (err) {
    console.error(`[tochka] заказ ${order.number}: ссылка не создана:`, err instanceof Error ? err.message : err);
    // Платёж не создан: заказ отменяем и возвращаем резерв, корзина у покупателя остаётся.
    await cancelUnpaidOrder(prisma, order.id, "банк не создал ссылку на оплату");
    return NextResponse.json(
      {
        orderId: order.id,
        orderNumber: order.number,
        paymentUrl: null,
        paymentError: true,
        error: "Платёжная система временно недоступна, попробуйте ещё раз",
      },
      { status: 502 },
    );
  }
}
