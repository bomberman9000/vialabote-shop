import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LEGAL_VERSION } from "@/lib/legal";
import { createPayment } from "@/lib/yookassa";
import { effectivePrice, toDiscountInput } from "@/lib/pricing/effective-price";

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

  // Продаются только опубликованные активные товары с положительной ценой.
  // include: discount — итоговая цена ВСЕГДА пересчитывается сервером через
  // effectivePrice(), а не берётся из клиента (клиент вообще не может
  // передать price — см. checkoutSchema выше, там его нет). Единственный
  // authoritative источник: Product.price + активный Discount из БД.
  const products = await prisma.product.findMany({
    where: { id: { in: [...wanted.keys()] }, status: "published", isActive: true, price: { gt: 0 } },
    include: { discount: true },
  });

  if (products.length !== wanted.size) {
    return NextResponse.json({ error: "Некоторые товары недоступны" }, { status: 400 });
  }

  // Проверка доступности. Атомарный резерв остатка делает модуль склада
  // (reserveForOrder) — пока он не подключён, одновременные покупки последней
  // единицы не защищены от гонки.
  if (products.some((p) => p.stock < wanted.get(p.id)!)) {
    return NextResponse.json({ error: "Недостаточно товара на складе" }, { status: 409 });
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
  if (totalAmount <= 0) {
    return NextResponse.json({ error: "Некорректная сумма заказа" }, { status: 400 });
  }
  const now = new Date().toISOString();
  const number = `V-${Date.now().toString(36).toUpperCase()}`;

  const order = await prisma.order.create({
    data: {
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
      status: "AWAITING_PAYMENT",
      items: { create: orderItems },
    },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;

  // Если ЮKassa не настроена — оформляем заказ без онлайн-оплаты (оплата при получении).
  if (!process.env.YOOKASSA_SHOP_ID || !process.env.YOOKASSA_SECRET_KEY) {
    await prisma.order.update({ where: { id: order.id }, data: { status: "NEW" } });
    return NextResponse.json({ orderId: order.id, orderNumber: order.number, paymentUrl: null });
  }

  try {
    const payment = await createPayment({
      orderId: order.id,
      orderNumber: order.number,
      amountRub: totalAmount / 100,
      returnUrl: `${appUrl}/checkout/success?order=${order.number}`,
      description: `Заказ ${order.number} на Vialabote`,
      customerEmail: data.customerEmail,
      receiptItems: orderItems.map((i) => ({
        description: i.title,
        quantity: i.quantity,
        amountKopecks: i.price,
      })),
    });

    const paymentUrl = payment.confirmation?.confirmation_url ?? null;

    await prisma.order.update({
      where: { id: order.id },
      data: { paymentId: payment.id, paymentUrl },
    });

    return NextResponse.json({ orderId: order.id, orderNumber: order.number, paymentUrl });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { orderId: order.id, orderNumber: order.number, paymentUrl: null, paymentError: true },
      { status: 200 },
    );
  }
}
