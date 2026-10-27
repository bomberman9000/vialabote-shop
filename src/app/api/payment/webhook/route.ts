import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { YooKassaWebhookEvent } from "@/lib/yookassa";

// ЮKassa шлёт уведомления с IP из известного пула — при желании можно
// дополнительно сверять исходный IP со списком https://yookassa.ru/developers/using-api/webhooks
export async function POST(req: Request) {
  // Маршрут доверяет телу запроса без проверки, поэтому без настроенной ЮKassa он закрыт:
  // иначе любой мог бы отметить заказ оплаченным одним POST-запросом.
  if (!process.env.YOOKASSA_SHOP_ID || !process.env.YOOKASSA_SECRET_KEY) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const event = (await req.json()) as YooKassaWebhookEvent;

  const orderId = event.object?.metadata?.orderId;
  if (!orderId) {
    return NextResponse.json({ ok: true });
  }

  if (event.event === "payment.succeeded") {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "PAID" },
    });
  } else if (event.event === "payment.canceled") {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "CANCELLED" },
    });
  }

  return NextResponse.json({ ok: true });
}
