import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { paymentExpiresAt, type OrderRow } from "@/lib/payments/online-order";
import { sweepInBackground, syncThrottled } from "@/lib/payments/tochka-runtime";

export const dynamic = "force-dynamic";

// Статус оплаты для страницы с таймером. Только номер, сумма и статус — без данных покупателя.
// Перед ответом заказ сверяется с банком (не чаще раза в 3 секунды).
export async function GET(_req: Request, { params }: { params: { number: string } }) {
  const number = decodeURIComponent(params.number);
  if (!/^V-[A-Z0-9]{4,20}$/.test(number)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let order = await prisma.order.findUnique({ where: { number }, include: { ozon: { select: { ozonOrderNumber: true, request: true } } } });
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    const r = await syncThrottled(order as OrderRow);
    if (r !== "SKIPPED" && r !== "OFF" && r !== "WAITING" && r !== "UNCHANGED") {
      order = (await prisma.order.findUnique({ where: { number }, include: { ozon: { select: { ozonOrderNumber: true, request: true } } } })) ?? order;
    }
  } catch (err) {
    console.error(`[tochka] статус ${number}:`, err instanceof Error ? err.message : err);
  }
  sweepInBackground();

  const expiresAt = paymentExpiresAt(order);
  const awaiting = order.status === "AWAITING_PAYMENT";
  return NextResponse.json(
    {
      number: order.number,
      status: order.status,
      totalAmount: order.totalAmount,
      expiresAt: expiresAt.toISOString(),
      serverNow: new Date().toISOString(),
      paymentUrl: awaiting && Date.now() < expiresAt.getTime() ? order.paymentUrl : null,
      // Доставка Ozon: крайний срок получения, показанный при оформлении
      deliveryMaxDate: order.deliveryMethod?.startsWith("OZON_") ? order.deliveryMaxDate?.toISOString() ?? null : null,
      // Как получить: номер заказа в приложении Ozon и две последние цифры номера, на который он оформлен
      // (по ним видно, в каком аккаунте искать). Полный номер и адрес сюда не отдаём — страница открыта по номеру заказа.
      ozonOrderNumber: order.ozon?.ozonOrderNumber ?? null,
      ozonPhoneEnd: order.ozon ? String((order.ozon.request as { recipient?: { phone?: string } })?.recipient?.phone ?? "").slice(-2) || null : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
