// Остаток сайта <-> склад FBS продавца в Ozon. Порядок важен:
//   1) продажи с маркетплейса Ozon (FBS, не заказы сайта) списываются с остатка сайта, отмены — возвращаются;
//      каждое отправление — ровно один раз (таблица OzonMarketplacePosting);
//   2) остаток сайта уходит на склад FBS в Ozon.
// Наоборот нельзя: сайт затёр бы в Ozon проданное на маркетплейсе. Заказы самого сайта (Ozon Доставка)
// уже списаны при оплате — их отправления пропускаем. Склад — OZON_FBS_WAREHOUSE_ID; без него ничего не делаем.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { FbsPosting } from "@/lib/delivery/ozon";
import type { Ozon } from "@/lib/delivery/ozon-service";

const LOOKBACK_MS = 3 * 24 * 3600_000;

export interface StockSyncReport {
  writtenOff: number;
  returned: number;
  pushed: number;
  errors: string[];
}

type Item = { productId: string; quantity: number };

async function changeStock(tx: Prisma.TransactionClient, items: Item[], sign: -1 | 1, reason: "WRITE_OFF" | "ADJUST") {
  for (const i of items) {
    const p = await tx.product.findUnique({ where: { id: i.productId } });
    if (!p) continue;
    const newStock = Math.max(0, p.stock + sign * i.quantity);
    if (newStock === p.stock) continue;
    await tx.product.update({ where: { id: p.id }, data: { stock: newStock, version: { increment: 1 } } });
    await tx.stockChangeLog.create({
      data: { productId: p.id, productTitle: p.title, oldStock: p.stock, newStock, delta: newStock - p.stock, reason, source: "OZON_MARKETPLACE" },
    });
  }
}

/** Шаг 1: отправления FBS за 3 дня -> остаток сайта. */
export async function importMarketplaceSales(ozon: Ozon, now = new Date()): Promise<Pick<StockSyncReport, "writtenOff" | "returned">> {
  const since = new Date(now.getTime() - LOOKBACK_MS).toISOString();
  const postings: FbsPosting[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const r = await ozon.client.fbsPostingList({ since, to: now.toISOString() }, cursor);
    postings.push(...(r.postings ?? []));
    if (!r.has_next || !r.cursor) break;
    cursor = r.cursor;
  }
  const ours = new Set(
    (await prisma.ozonOrder.findMany({ where: { ozonOrderNumber: { not: null } }, select: { ozonOrderNumber: true } })).map((o) => o.ozonOrderNumber!),
  );
  const offers = await prisma.product.findMany({ where: { ozonOfferId: { not: null } }, select: { id: true, ozonOfferId: true } });
  const byOffer = new Map(offers.map((p) => [p.ozonOfferId!, p.id]));

  // Первый запуск: всё, что уже есть в Ozon, учтено в остатках, выставленных владельцем, — только запоминаем.
  const baseline = (await prisma.ozonMarketplacePosting.count()) === 0;
  let writtenOff = 0;
  let returned = 0;
  for (const p of postings) {
    if (!p.posting_number || (p.order_number && ours.has(p.order_number))) continue;
    const cancelled = p.status === "cancelled";
    const items: Item[] = (p.products ?? [])
      .map((x) => ({ productId: byOffer.get(x.offer_id ?? "") ?? "", quantity: x.quantity ?? 0 }))
      .filter((x) => x.productId && x.quantity > 0);
    await prisma.$transaction(async (tx) => {
      const seen = await tx.ozonMarketplacePosting.findUnique({ where: { postingNumber: p.posting_number! } });
      if (!seen) {
        await tx.ozonMarketplacePosting.create({
          data: { postingNumber: p.posting_number!, state: cancelled || baseline ? "SKIPPED" : "WRITTEN_OFF", items: items as unknown as Prisma.InputJsonValue },
        });
        if (!cancelled && !baseline) {
          await changeStock(tx, items, -1, "WRITE_OFF");
          writtenOff++;
        }
      } else if (seen.state === "WRITTEN_OFF" && cancelled) {
        // Возвращаем ровно то, что списали (а не то, что Ozon прислал сейчас).
        const upd = await tx.ozonMarketplacePosting.updateMany({ where: { postingNumber: seen.postingNumber, state: "WRITTEN_OFF" }, data: { state: "RETURNED" } });
        if (upd.count === 1) {
          await changeStock(tx, seen.items as unknown as Item[], 1, "ADJUST");
          returned++;
        }
      }
    });
  }
  return { writtenOff, returned };
}

/** Шаг 2: остаток сайта -> склад FBS в Ozon (по 100 позиций). */
export async function pushSiteStock(ozon: Ozon, warehouseId: number): Promise<{ pushed: number; errors: string[] }> {
  const products = await prisma.product.findMany({ where: { status: "published", ozonOfferId: { not: null } }, select: { ozonOfferId: true, stock: true } });
  const stocks = products.map((p) => ({ offer_id: p.ozonOfferId!, stock: p.stock, warehouse_id: warehouseId }));
  let pushed = 0;
  const errors: string[] = [];
  for (let i = 0; i < stocks.length; i += 100) {
    const r = await ozon.client.stocksUpdate(stocks.slice(i, i + 100));
    for (const x of r.result ?? []) {
      if (x.updated) pushed++;
      else errors.push(`остаток ${x.offer_id}: ${(x.errors ?? []).map((e) => e.code).join(",") || "не обновлён"}`);
    }
  }
  return { pushed, errors };
}

export async function syncOzonStock(ozon: Ozon | null, env: NodeJS.ProcessEnv = process.env): Promise<StockSyncReport> {
  const report: StockSyncReport = { writtenOff: 0, returned: 0, pushed: 0, errors: [] };
  const warehouseId = Number(env.OZON_FBS_WAREHOUSE_ID);
  if (!ozon || !Number.isSafeInteger(warehouseId) || warehouseId <= 0) return report;
  try {
    Object.assign(report, await importMarketplaceSales(ozon));
  } catch (err) {
    // Не смогли прочитать продажи — остаток в Ozon не трогаем: иначе затрём проданное на маркетплейсе.
    report.errors.push(`продажи Ozon: ${err instanceof Error ? err.message : String(err)}`);
    return report;
  }
  try {
    const r = await pushSiteStock(ozon, warehouseId);
    report.pushed = r.pushed;
    report.errors.push(...r.errors);
  } catch (err) {
    report.errors.push(`остатки в Ozon: ${err instanceof Error ? err.message : String(err)}`);
  }
  return report;
}
