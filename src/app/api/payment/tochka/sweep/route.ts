import { NextResponse } from "next/server";
import { sweepNow } from "@/lib/payments/tochka-runtime";

export const dynamic = "force-dynamic";

// Вызывается таймером systemd на сервере раз в минуту (vialabote-tochka-sweep.timer):
// сверяет с банком все заказы, ждущие оплаты. Безопасен при любом вызове: только сверка с API банка,
// идемпотентен и ограничен одним запуском в 30 секунд на процесс.
export async function POST() {
  try {
    const changed = await sweepNow();
    return NextResponse.json({ ok: true, changed }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[tochka] sweep:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
