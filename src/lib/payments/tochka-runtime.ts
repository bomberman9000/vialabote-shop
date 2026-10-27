// Общие для маршрутов обёртки: сверка с банком не чаще раза в несколько секунд на заказ,
// «подметальщик» не чаще раза в 30 секунд (в пределах процесса), уведомление владельцу о переходах.
import { prisma } from "@/lib/prisma";
import { getTochkaConfig } from "@/lib/tochka";
import { syncOrderPayment, sweepExpiredOrders, type OrderRow, type SyncDeps, type SyncOutcome } from "./online-order";
import { notifyOwner } from "./notify-owner";

const lastSync = new Map<string, number>();
let lastSweep = 0;

export const SYNC_MIN_INTERVAL_MS = 3_000;
export const SWEEP_MIN_INTERVAL_MS = 30_000;

const onOutcome: SyncDeps["onOutcome"] = (order, outcome) => {
  notifyOwner(order, outcome).catch(() => undefined);
};

export async function syncThrottled(order: OrderRow, force = false): Promise<SyncOutcome | "SKIPPED" | "OFF"> {
  const cfg = getTochkaConfig();
  if (!cfg) return "OFF";
  const now = Date.now();
  if (!force && now - (lastSync.get(order.id) ?? 0) < SYNC_MIN_INTERVAL_MS) return "SKIPPED";
  lastSync.set(order.id, now);
  if (lastSync.size > 5_000) lastSync.clear();
  return syncOrderPayment(prisma, order, { cfg, onOutcome });
}

/** Сверка всех ждущих оплаты заказов. null — Точка не настроена или прошло меньше 30 с с прошлого запуска. */
export async function sweepNow(): Promise<number | null> {
  const cfg = getTochkaConfig();
  const now = Date.now();
  if (!cfg || now - lastSweep < SWEEP_MIN_INTERVAL_MS) return null;
  lastSweep = now;
  return sweepExpiredOrders(prisma, { cfg, onOutcome });
}

export function sweepInBackground(): void {
  sweepNow().catch((err) => console.error("[tochka] sweep:", err instanceof Error ? err.message : err));
}
