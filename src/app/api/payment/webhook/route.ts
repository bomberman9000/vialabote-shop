import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPayment, type YooKassaWebhookEvent } from "@/lib/yookassa";

// Тело webhook'а НЕ является доказательством оплаты (оно не подписано).
// Из тела берём только id платежа, а статус, сумму, валюту и привязку к заказу
// проверяем запросом GET /payments/{id} к ЮKassa. Обработка идемпотентна:
// переход статуса заказа допускается только из AWAITING_PAYMENT, поэтому
// повтор, подделка или webhook вне очереди ничего не ломают.
export async function POST(req: Request) {
  let event: YooKassaWebhookEvent;
  try {
    event = (await req.json()) as YooKassaWebhookEvent;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const paymentId = event?.object?.id;
  if (typeof paymentId !== "string" || !paymentId) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (event.event !== "payment.succeeded" && event.event !== "payment.canceled") {
    return NextResponse.json({ ok: true });
  }

  // Заказ ищем по сохранённому paymentId — произвольный id из чужого тела не найдётся.
  const order = await prisma.order.findFirst({ where: { paymentId } });
  if (!order) {
    return NextResponse.json({ ok: true });
  }

  let payment;
  try {
    payment = await getPayment(paymentId);
  } catch (err) {
    console.error("payment webhook: не удалось проверить платёж", err);
    // 5xx — ЮKassa повторит доставку позже.
    return NextResponse.json({ error: "verification failed" }, { status: 502 });
  }

  const amountKopecks = Math.round(Number(payment.amount?.value) * 100);
  const consistent =
    payment.id === paymentId &&
    payment.metadata?.orderId === order.id &&
    payment.amount?.currency === "RUB" &&
    amountKopecks === order.totalAmount;
  if (!consistent) {
    console.error("payment webhook: платёж не сходится с заказом", { paymentId, orderId: order.id });
    return NextResponse.json({ ok: true });
  }

  if (payment.status === "succeeded" && payment.paid === true) {
    await prisma.order.updateMany({
      where: { id: order.id, status: "AWAITING_PAYMENT" },
      data: { status: "PAID" },
    });
  } else if (payment.status === "canceled") {
    await prisma.order.updateMany({
      where: { id: order.id, status: "AWAITING_PAYMENT" },
      data: { status: "CANCELLED" },
    });
  }

  return NextResponse.json({ ok: true });
}
