import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { allowRequest, getOzon } from "@/lib/delivery/ozon-service";
import { syncOzonOrder } from "@/lib/delivery/ozon-orders";

export const dynamic = "force-dynamic";

const SYNC_THROTTLE_MS = 2 * 60_000;

// ЗАГОТОВКА: в кабинете Ozon этот адрес НЕ зарегистрирован. Как и у вебхука Точки, тело — не доверенное:
// из него берётся лишь номер отправления как подсказка «проверь», а статус запрашивается у Ozon
// (posting/fbs/get). Подделка может только вызвать лишнюю проверку известного нам заказа.
export async function POST(req: Request) {
  const ozon = getOzon();
  if (!ozon) return NextResponse.json({ ok: false, error: "disabled" }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { message_type?: unknown; posting_number?: unknown } | null;
  // Проверка доступности, которую Ozon шлёт при подключении.
  if (body?.message_type === "TYPE_PING") return NextResponse.json({ version: "1", name: "vialabote-shop", time: new Date().toISOString() });

  const posting = typeof body?.posting_number === "string" && /^[0-9-]{5,40}$/.test(body.posting_number) ? body.posting_number : null;
  if (!posting) return NextResponse.json({ result: true, ignored: true });

  // Адрес не защищён подписью, а номер отправления виден покупателю: без троттлинга любой мог бы
  // тратить квоту Ozon магазина (и мешать созданию заказов). Не чаще раза в 2 минуты на заказ.
  if (!allowRequest(req, "ozon-webhook", 60)) return NextResponse.json({ result: true, throttled: true });
  const known = await prisma.ozonOrder.findFirst({ where: { postingNumbers: { has: posting } }, select: { id: true, syncedAt: true } });
  if (!known) return NextResponse.json({ result: true, ignored: true });
  if (known.syncedAt && Date.now() - known.syncedAt.getTime() < SYNC_THROTTLE_MS) return NextResponse.json({ result: true, throttled: true });
  try {
    await syncOzonOrder(known.id, ozon);
  } catch (err) {
    console.error("ozon webhook: проверка не удалась", err instanceof Error ? err.message : err);
  }
  return NextResponse.json({ result: true });
}
