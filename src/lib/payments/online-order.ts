// Онлайн-оплата заказа через платёжную ссылку Точки.
//
// Жизненный цикл:
//   оформление -> AWAITING_PAYMENT + резерв товара (одна транзакция) -> ссылка банка
//   -> у покупателя PAYMENT_WINDOW_MS (10 минут) на оплату, таймер на /checkout/pay/<номер>
//   -> APPROVED по данным API банка: PAID + списание резерва (commitOrder)
//   -> время вышло без оплаты: CANCELLED + возврат резерва на склад (releaseOrder)
//
// Статус всегда берётся из API банка (getPaymentOperation), никогда из браузера или тела вебхука.
// Переходы статуса — условный updateMany в той же транзакции, что и движение склада:
// параллельные вебхук, страница оплаты и «подметальщик» не могут обработать заказ дважды.
import type { Prisma, PrismaClient } from "@prisma/client";
import { commitOrder, releaseOrder, reserveForOrder, type OrderLine, type Tx } from "@/lib/stock/movements";
import { getPaymentOperation, type FetchLike, type TochkaConfig } from "@/lib/tochka";

export const PAYMENT_WINDOW_MS = 10 * 60_000;

type Db = Pick<PrismaClient, "order" | "orderItem" | "$transaction"> & { $transaction: PrismaClient["$transaction"] };

export interface OrderRow {
  id: string;
  number: string;
  status: string;
  totalAmount: number;
  paymentId: string | null;
  paymentUrl: string | null;
  comment: string | null;
  createdAt: Date;
}

export function paymentExpiresAt(order: Pick<OrderRow, "createdAt">): Date {
  return new Date(order.createdAt.getTime() + PAYMENT_WINDOW_MS);
}

export interface NewOrderData {
  number: string;
  userId?: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  deliveryCity: string;
  deliveryAddress: string;
  comment?: string;
  totalAmount: number;
  // согласия (152-ФЗ / 38-ФЗ): ISO-время отметки или null
  offerAcceptedAt?: string;
  pdnConsentAt?: string | null;
  adsConsentAt?: string | null;
  consentSource?: string;
  legalVersion?: string;
  // Доставка Ozon (src/lib/delivery): цена уже в totalAmount; заказ в Ozon создаётся только после оплаты.
  deliveryMethod?: string;
  deliveryPrice?: number;
  deliveryMaxDate?: Date;
  ozon?: { create: { deliveryType: string; request: Prisma.InputJsonValue; quote: Prisma.InputJsonValue } };
}

export interface NewOrderItem extends OrderLine {
  title: string;
  price: number;
}

/** Заказ + позиции + резерв склада — одной транзакцией. Нехватка -> StockError OUT_OF_STOCK, ничего не создано. */
export async function placeOnlineOrder(db: Db, data: NewOrderData, items: NewOrderItem[]) {
  return db.$transaction(async (tx) => {
    const order = await tx.order.create({ data: { ...data, status: "AWAITING_PAYMENT" } });
    for (const it of items) {
      await tx.orderItem.create({
        data: { orderId: order.id, productId: it.productId, title: it.title, price: it.price, quantity: it.quantity },
      });
    }
    await reserveForOrder(tx as unknown as Tx, {
      orderId: order.id,
      items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      source: "SITE_ORDER",
    });
    return order;
  });
}

/** AWAITING_PAYMENT -> CANCELLED + возврат резерва. Повторный вызов ничего не делает. */
export async function cancelUnpaidOrder(db: Db, orderId: string, note: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    const moved = await tx.order.updateMany({
      where: { id: orderId, status: "AWAITING_PAYMENT" },
      data: { status: "CANCELLED", comment: appendNote(order?.comment ?? null, note) },
    });
    if (moved.count !== 1) return false;
    await releaseOrder(tx as unknown as Tx, { orderId, source: "SITE_ORDER" });
    return true;
  });
}

function appendNote(comment: string | null, note: string): string {
  return comment ? `${comment}\n[оплата] ${note}` : `[оплата] ${note}`;
}

export type SyncOutcome =
  | "PAID" // оплата подтверждена банком сейчас
  | "PAID_LATE" // оплата пришла после отмены по таймеру — резерв уже был возвращён, нужна проверка наличия
  | "EXPIRED" // время вышло, заказ отменён, товар вернулся на склад
  | "AMOUNT_MISMATCH" // банк подтвердил другую сумму — ничего не меняем, нужна ручная проверка
  | "WAITING" // ещё ждём оплату
  | "UNCHANGED"; // заказ уже не ждёт оплаты

export interface SyncDeps {
  cfg: TochkaConfig;
  fetchImpl?: FetchLike;
  now?: Date;
  /** Вызывается ровно один раз на переход (PAID / PAID_LATE) и на AMOUNT_MISMATCH — для уведомления владельца. */
  onOutcome?: (order: OrderRow, outcome: SyncOutcome) => void;
}

/** Сверить заказ с банком и выполнить положенный переход. Безопасно вызывать сколько угодно раз и параллельно. */
export async function syncOrderPayment(db: Db, order: OrderRow, deps: SyncDeps): Promise<SyncOutcome> {
  const outcome = await syncOnce(db, order, deps);
  if (deps.onOutcome && (outcome === "PAID" || outcome === "PAID_LATE" || outcome === "AMOUNT_MISMATCH")) {
    try {
      deps.onOutcome(order, outcome);
    } catch {
      /* уведомление не должно ломать оплату */
    }
  }
  return outcome;
}

async function syncOnce(db: Db, order: OrderRow, deps: SyncDeps): Promise<SyncOutcome> {
  const now = deps.now ?? new Date();
  if (order.status !== "AWAITING_PAYMENT" && order.status !== "CANCELLED") return "UNCHANGED";
  if (!order.paymentId) {
    if (order.status === "AWAITING_PAYMENT" && now > paymentExpiresAt(order)) {
      return (await cancelUnpaidOrder(db, order.id, "ссылка на оплату не создана, заказ отменён")) ? "EXPIRED" : "UNCHANGED";
    }
    return order.status === "AWAITING_PAYMENT" ? "WAITING" : "UNCHANGED";
  }

  const op = await getPaymentOperation(deps.cfg, order.paymentId, deps.fetchImpl);

  if (op.status === "APPROVED") {
    if (op.amountKopecks !== order.totalAmount) {
      console.error(`[tochka] заказ ${order.number}: банк подтвердил ${op.amountKopecks} коп., ожидалось ${order.totalAmount}`);
      return "AMOUNT_MISMATCH";
    }
    return db.$transaction(async (tx) => {
      const paid = await tx.order.updateMany({ where: { id: order.id, status: "AWAITING_PAYMENT" }, data: { status: "PAID" } });
      if (paid.count === 1) {
        await commitOrder(tx as unknown as Tx, { orderId: order.id, source: "PAYMENT_WEBHOOK" });
        return "PAID" as const;
      }
      const current = await tx.order.findUnique({ where: { id: order.id } });
      const late = await tx.order.updateMany({
        where: { id: order.id, status: "CANCELLED" },
        data: {
          status: "PAID",
          comment: appendNote(current?.comment ?? null, "оплата пришла после истечения 10 минут — резерв был снят, проверьте наличие"),
        },
      });
      if (late.count === 1) {
        console.warn(`[tochka] заказ ${order.number}: оплата после отмены по таймеру — проверьте наличие`);
        return "PAID_LATE" as const;
      }
      return "UNCHANGED" as const;
    });
  }

  if (order.status === "AWAITING_PAYMENT" && now > paymentExpiresAt(order)) {
    return (await cancelUnpaidOrder(db, order.id, `не оплачен за 10 минут (статус банка ${op.status})`)) ? "EXPIRED" : "UNCHANGED";
  }
  return order.status === "AWAITING_PAYMENT" ? "WAITING" : "UNCHANGED";
}

/**
 * Сверить с банком все заказы, ждущие оплаты (запускается таймером раз в минуту): оплаченные -> PAID,
 * просроченные неоплаченные -> CANCELLED с возвратом товара. Работает, даже если покупатель закрыл
 * вкладку и банк не вернул его на сайт.
 */
export async function sweepExpiredOrders(db: Db, deps: SyncDeps, limit = 20): Promise<number> {
  const now = deps.now ?? new Date();
  const stale = await db.order.findMany({
    where: { status: "AWAITING_PAYMENT" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let done = 0;
  for (const o of stale) {
    try {
      const r = await syncOrderPayment(db, o as OrderRow, { ...deps, now });
      if (r === "EXPIRED" || r === "PAID") done++;
    } catch (err) {
      console.error(`[tochka] sweep ${o.number}:`, err instanceof Error ? err.message : err);
    }
  }
  return done;
}
