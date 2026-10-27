// Общие для маршрутов обёртки: сверка с банком не чаще раза в несколько секунд на заказ
// и «подметальщик» просроченных заказов не чаще раза в минуту (в пределах процесса).
import { prisma } from "@/lib/prisma";
import { getTochkaConfig } from "@/lib/tochka";
import { syncOrderPayment, sweepExpiredOrders, type OrderRow, type SyncOutcome } from "./online-order";

const lastSync = new Map<string, number>();
let lastSweep = 0;

export const SYNC_MIN_INTERVAL_MS = 3_000;
export const SWEEP_MIN_INTERVAL_MS = 60_000;

export async function syncThrottled(order: OrderRow, force = false): Promise<SyncOutcome | "SKIPPED" | "OFF"> {
  const cfg = getTochkaConfig();
  if (!cfg) return "OFF";
  const now = Date.now();
  if (!force && now - (lastSync.get(order.id) ?? 0) < SYNC_MIN_INTERVAL_MS) return "SKIPPED";
  lastSync.set(order.id, now);
  if (lastSync.size > 5_000) lastSync.clear();
  return syncOrderPayment(prisma, order, { cfg });
}

export function sweepInBackground(): void {
  const cfg = getTochkaConfig();
  const now = Date.now();
  if (!cfg || now - lastSweep < SWEEP_MIN_INTERVAL_MS) return;
  lastSweep = now;
  sweepExpiredOrders(prisma, { cfg }).catch((err) => console.error("[tochka] sweep:", err instanceof Error ? err.message : err));
}
