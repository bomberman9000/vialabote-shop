// Движения склада — ЕДИНСТВЕННОЕ место, где меняется Product.stock (сайт, оплата, бот, Web Admin).
// Каждая функция принимает транзакцию вызывающего (`tx`) и в ней же пишет StockChangeLog:
// если журнал не записался, откатится и остаток. Функции НЕ открывают транзакцию сами —
// заказ, резерв и журнал фиксируются вызывающим одним $transaction.
//
// Модель: резерв при создании заказа сразу уменьшает stock (товар больше нельзя продать
// дважды); отмена/неоплата возвращает резерв (RELEASE); успешная оплата фиксирует резерв
// как списание (WRITE_OFF, delta 0 — stock уже уменьшен резервом).
//
// Конкуренция: резерв — условное UPDATE ... WHERE stock >= qty (атомарно на строку в
// PostgreSQL), а не «прочитать, проверить, записать». Два заказа на последнюю единицу:
// второй получает OUT_OF_STOCK. Все движения ОДНОГО заказа (reserve/release/commit)
// сериализуются блокировкой строки заказа (SELECT … FOR UPDATE, lockOrder): иначе в
// READ COMMITTED отмена и оплата одновременно видят «чистый» журнал и обе срабатывают —
// товар и вернулся на склад, и списан. Идемпотентность движений заказа держится на
// @@unique([orderId, productId, reason]): повтор того же движения либо видится заранее
// (вернётся без изменений), либо при гонке падает P2002 и откатывает свою транзакцию —
// isDuplicateMovement(err) позволяет вызывающему считать это «уже сделано».
import type { Prisma } from "@prisma/client";

export type Tx = Prisma.TransactionClient;
export type StockReason = "ADJUST" | "RESERVE" | "RELEASE" | "WRITE_OFF";
export type StockSource = "TELEGRAM" | "WEB_ADMIN" | "SITE_ORDER" | "PAYMENT_WEBHOOK";
export const MAX_STOCK = 100_000;

export type StockErrorCode = "OUT_OF_STOCK" | "NOT_FOUND" | "VERSION_CONFLICT" | "INVALID";

export class StockError extends Error {
  constructor(
    public readonly code: StockErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "StockError";
  }
}

/** Гонка двух одинаковых движений заказа: вторая транзакция упала на unique — движение уже сделано. */
export function isDuplicateMovement(err: unknown): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } } | null;
  if (e?.code !== "P2002") return false;
  const target = e.meta?.target;
  return Array.isArray(target) ? target.includes("reason") : String(target ?? "").includes("reason");
}

interface LogInput {
  product: { id: string; title: string };
  oldStock: number;
  newStock: number;
  reason: StockReason;
  source: StockSource;
  orderId?: string | null;
  actorUserId?: string | null;
  actorTelegramUserId?: string | null;
  confirmationId?: string | null;
}

async function writeLog(tx: Tx, l: LogInput) {
  return tx.stockChangeLog.create({
    data: {
      productId: l.product.id,
      productTitle: l.product.title,
      oldStock: l.oldStock,
      newStock: l.newStock,
      delta: l.newStock - l.oldStock,
      reason: l.reason,
      orderId: l.orderId ?? null,
      source: l.source,
      actorUserId: l.actorUserId ?? null,
      actorTelegramUserId: l.actorTelegramUserId ?? null,
      confirmationId: l.confirmationId ?? null,
    },
  });
}

// ---------------------------------------------------------------- ADJUST (бот, Web Admin)

export interface AdjustStockInput {
  productId: string;
  /** OCC: правка проходит только если товар не менялся с момента предпросмотра (в т.ч. резервом). */
  expectedVersion: number;
  newStock: number;
  source: StockSource;
  actorUserId?: string;
  actorTelegramUserId?: string;
  confirmationId?: string;
}

/** Ручная правка остатка («выставить N»). Пишет ADJUST. Права проверяет вызывающий. */
export async function adjustStock(tx: Tx, input: AdjustStockInput) {
  if (!Number.isInteger(input.newStock) || input.newStock < 0 || input.newStock > MAX_STOCK) {
    throw new StockError("INVALID", `Остаток должен быть целым числом от 0 до ${MAX_STOCK}`);
  }
  const before = await tx.product.findUnique({ where: { id: input.productId } });
  if (!before) throw new StockError("NOT_FOUND", "Товар не найден", { productId: input.productId });
  if (before.version !== input.expectedVersion) {
    throw new StockError(
      "VERSION_CONFLICT",
      `Товар изменился после формирования команды (сейчас остаток ${before.stock}). Откройте товар заново.`,
      { currentVersion: before.version, currentStock: before.stock },
    );
  }
  const updated = await tx.product.updateMany({
    where: { id: input.productId, version: input.expectedVersion },
    data: { stock: input.newStock, version: { increment: 1 } },
  });
  if (updated.count === 0) {
    throw new StockError("VERSION_CONFLICT", "Товар изменился параллельно во время записи. Откройте товар заново.");
  }
  const after = await tx.product.findUniqueOrThrow({ where: { id: input.productId } });
  await writeLog(tx, {
    product: before,
    oldStock: before.stock,
    newStock: after.stock,
    reason: "ADJUST",
    source: input.source,
    actorUserId: input.actorUserId,
    actorTelegramUserId: input.actorTelegramUserId,
    confirmationId: input.confirmationId,
  });
  return { before, after };
}

// ---------------------------------------------------------------- заказы

export interface OrderLine {
  productId: string;
  quantity: number;
}

export interface MovementLine {
  productId: string;
  quantity: number;
  stockAfter: number;
}

/** Склеить повторяющиеся товары и упорядочить по id — одинаковый порядок блокировок строк у всех заказов. */
export function normalizeLines(items: OrderLine[]): OrderLine[] {
  const byId = new Map<string, number>();
  for (const it of items) {
    if (!it.productId || !Number.isInteger(it.quantity) || it.quantity <= 0) {
      throw new StockError("INVALID", "Количество в заказе должно быть целым положительным", { productId: it.productId });
    }
    byId.set(it.productId, (byId.get(it.productId) ?? 0) + it.quantity);
  }
  return Array.from(byId, ([productId, quantity]) => ({ productId, quantity })).sort((a, b) =>
    a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0,
  );
}

/**
 * Блокирует строку заказа до конца транзакции вызывающего. Второе движение того же заказа
 * ждёт здесь, а затем видит в журнале уже зафиксированный результат первого.
 * Заказа нет -> NOT_FOUND (движение без заказа — ошибка вызывающего).
 */
export async function lockOrder(tx: Tx, orderId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
  if (rows.length === 0) throw new StockError("NOT_FOUND", "Заказ не найден", { orderId });
}

async function orderMovements(tx: Tx, orderId: string) {
  const rows = await tx.stockChangeLog.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
  const has = (productId: string, reason: StockReason) => rows.some((r) => r.productId === productId && r.reason === reason);
  return { rows, reserves: rows.filter((r) => r.reason === "RESERVE"), has };
}

export interface ReserveResult {
  /** true — резерв по этому заказу уже был (повторный вызов), ничего не изменено */
  alreadyReserved: boolean;
  lines: MovementLine[];
}

/**
 * Резерв товаров заказа: для каждой позиции условно `stock -= qty` только если `stock >= qty`.
 * Не хватает хотя бы одной позиции -> StockError("OUT_OF_STOCK", …, { productId, requested, available })
 * — вызывающий НЕ ловит её внутри $transaction, и вся транзакция (заказ + уже сделанные резервы) откатывается.
 * Повторный вызов для того же orderId ничего не меняет (alreadyReserved: true).
 */
export async function reserveForOrder(
  tx: Tx,
  { orderId, items, source = "SITE_ORDER" }: { orderId: string; items: OrderLine[]; source?: StockSource },
): Promise<ReserveResult> {
  if (!orderId) throw new StockError("INVALID", "orderId обязателен");
  const lines = normalizeLines(items);
  if (lines.length === 0) throw new StockError("INVALID", "В заказе нет позиций");

  await lockOrder(tx, orderId);
  const existing = await orderMovements(tx, orderId);
  if (existing.reserves.length > 0) {
    return {
      alreadyReserved: true,
      lines: existing.reserves.map((r) => ({ productId: r.productId, quantity: -r.delta, stockAfter: r.newStock })),
    };
  }

  const done: MovementLine[] = [];
  for (const line of lines) {
    // Атомарная проверка-и-списание: никаких «прочитали stock, сравнили, записали».
    const updated = await tx.product.updateMany({
      where: { id: line.productId, stock: { gte: line.quantity } },
      // version++: устаревший предпросмотр правки остатка в боте после резерва не перезапишет его
      data: { stock: { decrement: line.quantity }, version: { increment: 1 } },
    });
    const product = await tx.product.findUnique({ where: { id: line.productId } });
    if (!product) throw new StockError("NOT_FOUND", "Товар не найден", { productId: line.productId });
    if (updated.count === 0) {
      throw new StockError("OUT_OF_STOCK", `Недостаточно товара «${product.title}»: доступно ${product.stock}, нужно ${line.quantity}`, {
        productId: product.id,
        title: product.title,
        requested: line.quantity,
        available: product.stock,
      });
    }
    await writeLog(tx, {
      product,
      oldStock: product.stock + line.quantity,
      newStock: product.stock,
      reason: "RESERVE",
      source,
      orderId,
    });
    done.push({ productId: product.id, quantity: line.quantity, stockAfter: product.stock });
  }
  return { alreadyReserved: false, lines: done };
}

export interface ReleaseResult {
  /** возвращено сейчас */
  released: MovementLine[];
  /** уже было возвращено раньше (повторный вызов) */
  alreadyReleased: string[];
  /** оплачено и списано — резерв НЕ возвращается (это уже не отмена, а возврат товара) */
  committed: string[];
}

/**
 * Вернуть резерв заказа (отмена, неоплата, истёк платёж). Идемпотентно: повторный вызов
 * ничего не возвращает второй раз. Позиции, уже списанные commitOrder, не трогает.
 * Заказ без резерва (создан до этой логики) — пустой результат, не ошибка.
 */
export async function releaseOrder(
  tx: Tx,
  { orderId, source = "PAYMENT_WEBHOOK" }: { orderId: string; source?: StockSource },
): Promise<ReleaseResult> {
  await lockOrder(tx, orderId);
  const m = await orderMovements(tx, orderId);
  const result: ReleaseResult = { released: [], alreadyReleased: [], committed: [] };
  for (const r of m.reserves) {
    if (m.has(r.productId, "RELEASE")) {
      result.alreadyReleased.push(r.productId);
      continue;
    }
    if (m.has(r.productId, "WRITE_OFF")) {
      result.committed.push(r.productId);
      continue;
    }
    const qty = -r.delta;
    await tx.product.updateMany({
      where: { id: r.productId },
      data: { stock: { increment: qty }, version: { increment: 1 } },
    });
    const product = await tx.product.findUnique({ where: { id: r.productId } });
    if (!product) {
      // Товар удалён после заказа: остаток вернуть некуда. Фиксируем факт строкой 0 -> 0
      // (delta 0 — инвариант Σdelta не нарушается) с пометкой в названии; позицию
      // считаем закрытой, повторный release её уже не тронет.
      await writeLog(tx, {
        product: { id: r.productId, title: `${r.productTitle} (товар удалён, ${qty} шт. не возвращены)` },
        oldStock: 0,
        newStock: 0,
        reason: "RELEASE",
        source,
        orderId,
      });
      result.released.push({ productId: r.productId, quantity: 0, stockAfter: 0 });
      continue;
    }
    await writeLog(tx, { product, oldStock: product.stock - qty, newStock: product.stock, reason: "RELEASE", source, orderId });
    result.released.push({ productId: product.id, quantity: qty, stockAfter: product.stock });
  }
  return result;
}

export interface CommitResult {
  /** списано сейчас (WRITE_OFF записан) */
  committed: string[];
  /** уже было списано раньше (повтор вебхука) */
  alreadyCommitted: string[];
  /**
   * резерв уже возвращён (заказ отменили, а оплата пришла позже). Склад НЕ трогаем —
   * вызывающий должен решить: вернуть деньги или заново зарезервировать (reserveForOrder с новым orderId нельзя,
   * поэтому — ручная правка). Пусто в нормальном потоке.
   */
  releasedBeforePayment: string[];
}

/**
 * Оплата прошла (`payment.succeeded`): резерв становится списанием — WRITE_OFF с delta 0
 * (stock уже уменьшен при резерве). Идемпотентно. После commit releaseOrder резерв не вернёт.
 */
export async function commitOrder(
  tx: Tx,
  { orderId, source = "PAYMENT_WEBHOOK" }: { orderId: string; source?: StockSource },
): Promise<CommitResult> {
  await lockOrder(tx, orderId);
  const m = await orderMovements(tx, orderId);
  const result: CommitResult = { committed: [], alreadyCommitted: [], releasedBeforePayment: [] };
  for (const r of m.reserves) {
    if (m.has(r.productId, "WRITE_OFF")) {
      result.alreadyCommitted.push(r.productId);
      continue;
    }
    if (m.has(r.productId, "RELEASE")) {
      result.releasedBeforePayment.push(r.productId);
      continue;
    }
    const product = await tx.product.findUnique({ where: { id: r.productId } });
    const stock = product?.stock ?? 0;
    await writeLog(tx, {
      product: product ?? { id: r.productId, title: r.productTitle },
      oldStock: stock,
      newStock: stock,
      reason: "WRITE_OFF",
      source,
      orderId,
    });
    result.committed.push(r.productId);
  }
  return result;
}
