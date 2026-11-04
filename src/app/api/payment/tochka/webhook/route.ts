import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTochkaConfig, getTochkaPublicKey, verifyWebhookJwt } from "@/lib/tochka";
import type { OrderRow } from "@/lib/payments/online-order";
import { sweepInBackground, syncThrottled } from "@/lib/payments/tochka-runtime";

export const dynamic = "force-dynamic";

// Вебхук Точки acquiringInternetPayment: тело — «голая» строка JWT (Content-Type: text/plain),
// подписанная RS256 ключом банка. Неверная подпись -> 401, ничего не делаем.
// Верная подпись -> берём только operationId и сверяем заказ с API банка: статус и сумма — оттуда.
// Ответ 200 обязателен, иначе банк повторяет отправку 30 раз.
export async function POST(req: Request) {
  if (!getTochkaConfig()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const raw = (await req.text()).slice(0, 20_000);

  let payload: Record<string, unknown> | null;
  try {
    payload = verifyWebhookJwt(raw, await getTochkaPublicKey());
  } catch (err) {
    console.error("[tochka] webhook: ключ банка недоступен:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "key_unavailable" }, { status: 503 }); // банк повторит
  }
  if (!payload) return NextResponse.json({ error: "bad_signature" }, { status: 401 });

  const operationId = typeof payload.operationId === "string" ? payload.operationId : null;
  console.info(`[tochka] webhook ${String(payload.webhookType ?? "?")} operation=${operationId ?? "-"} status=${String(payload.status ?? "-")}`);
  if (operationId) {
    const order = await prisma.order.findFirst({ where: { paymentId: operationId } });
    if (order) {
      try {
        const r = await syncThrottled(order as OrderRow, true);
        console.info(`[tochka] webhook заказ ${order.number}: ${r}`);
      } catch (err) {
        console.error(`[tochka] webhook заказ ${order.number}:`, err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "sync_failed" }, { status: 502 }); // банк повторит
      }
    }
  }
  sweepInBackground();
  return NextResponse.json({ ok: true });
}
