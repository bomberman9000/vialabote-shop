import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LEGAL_VERSION } from "@/lib/legal";
import { effectivePrice, toDiscountInput } from "@/lib/pricing/effective-price";
import { createPaymentLink, getTochkaConfig } from "@/lib/tochka";
import { cancelUnpaidOrder, placeOnlineOrder } from "@/lib/payments/online-order";
import { reserveForOrder, StockError } from "@/lib/stock/movements";

const checkoutSchema = z.object({
  customerName: z.string().min(2),
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

  const totalAmount = orderItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  if (totalAmount <= 0 || orderItems.some((i) => i.price <= 0)) {
    return NextResponse.json({ error: "Некорректная сумма заказа" }, { status: 400 });
  }

  const number = `V-${Date.now().toString(36).toUpperCase()}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
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
  };

  const tochka = getTochkaConfig();

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
  const payPage = `/checkout/pay/${encodeURIComponent(order.number)}`;
  try {
    const link = await createPaymentLink(tochka, {
      amountKopecks: totalAmount,
      purpose: `Оплата заказа ${order.number} в магазине VIA LABOTE`,
      successUrl: `${appUrl}${payPage}`,
      failUrl: `${appUrl}${payPage}`,
    });
    await prisma.order.update({ where: { id: order.id }, data: { paymentId: link.operationId, paymentUrl: link.paymentLink } });
    return NextResponse.json({ orderId: order.id, orderNumber: order.number, paymentUrl: null, payPage });
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
