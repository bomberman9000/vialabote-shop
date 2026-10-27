import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createPayment } from "@/lib/yookassa";
import { createPaymentLink, getTochkaConfig } from "@/lib/tochka";
import { cancelUnpaidOrder, placeOnlineOrder } from "@/lib/payments/online-order";
import { StockError } from "@/lib/stock/movements";
import { effectivePrice, toDiscountInput } from "@/lib/pricing/effective-price";

const checkoutSchema = z.object({
  customerName: z.string().min(2),
  customerEmail: z.string().email(),
  customerPhone: z.string().min(5),
  deliveryCity: z.string().min(2),
  deliveryAddress: z.string().min(5),
  comment: z.string().optional(),
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

  // include: discount — итоговая цена ВСЕГДА пересчитывается сервером через
  // effectivePrice(), а не берётся из клиента (клиент вообще не может
  // передать price — см. checkoutSchema выше, там его нет). Единственный
  // authoritative источник: Product.price + активный Discount из БД.
  const products = await prisma.product.findMany({
    where: { id: { in: data.items.map((i) => i.productId) } },
    include: { discount: true },
  });

  if (products.length !== data.items.length) {
    return NextResponse.json({ error: "Некоторые товары недоступны" }, { status: 400 });
  }

  const orderItems = data.items.map((i) => {
    const product = products.find((p) => p.id === i.productId)!;
    const priced = effectivePrice(product.price, toDiscountInput(product.discount));
    return {
      productId: product.id,
      title: product.title,
      price: priced.effectivePrice,
      quantity: i.quantity,
    };
  });

  const totalAmount = orderItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const number = `V-${Date.now().toString(36).toUpperCase()}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;

  // Онлайн-оплата через Точку: заказ + резерв одной транзакцией, ссылка банка, 10 минут на оплату.
  const tochka = getTochkaConfig();
  if (tochka) {
    const unavailable = products.find((p) => p.status !== "published" || !p.isActive || p.price <= 0);
    if (unavailable) {
      return NextResponse.json({ error: `Товар «${unavailable.title}» сейчас недоступен` }, { status: 409 });
    }
    let order;
    try {
      order = await placeOnlineOrder(
        prisma,
        {
          number,
          userId: session?.user ? (session.user as { id: string }).id : undefined,
          customerName: data.customerName,
          customerEmail: data.customerEmail,
          customerPhone: data.customerPhone,
          deliveryCity: data.deliveryCity,
          deliveryAddress: data.deliveryAddress,
          comment: data.comment,
          totalAmount,
        },
        orderItems,
      );
    } catch (err) {
      if (err instanceof StockError && err.code === "OUT_OF_STOCK") {
        return NextResponse.json({ error: err.message, outOfStock: err.details }, { status: 409 });
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
      await cancelUnpaidOrder(prisma, order.id, "банк не создал ссылку на оплату");
      return NextResponse.json(
        { orderId: order.id, orderNumber: order.number, paymentUrl: null, paymentError: true, error: "Платёжная система временно недоступна, попробуйте ещё раз" },
        { status: 502 },
      );
    }
  }

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
      totalAmount,
      status: "AWAITING_PAYMENT",
      items: { create: orderItems },
    },
  });

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
