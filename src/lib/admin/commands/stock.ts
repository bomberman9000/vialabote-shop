import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { AdminActor } from "../actor";
import { authorizeAdmin } from "../authorize";
import { writeAuditLog } from "../audit";
import { AdminCommandError } from "../errors";

const MAX_STOCK = 100_000;

const setStockSchema = z.object({
  productId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  stock: z.number().int().min(0).max(MAX_STOCK),
});

export interface SetStockMeta {
  actorTelegramUserId?: string;
  confirmationId?: string;
}

/**
 * Единственная точка правки остатка из бота (годится и для Web Admin): проверка прав,
 * OCC по version, правка + StockChangeLog + AuditLog в ОДНОЙ транзакции — если журнал
 * не записался (например, миграция ещё не применена), остаток не меняется.
 */
export async function setStock(actor: AdminActor, rawInput: unknown, meta: SetStockMeta = {}) {
  await authorizeAdmin(actor);
  const input = setStockSchema.parse(rawInput);

  return prisma.$transaction(async (tx) => {
    const before = await tx.product.findUnique({ where: { id: input.productId } });
    if (!before) throw new AdminCommandError("NOT_FOUND", "Товар не найден");
    if (before.version !== input.expectedVersion) {
      throw new AdminCommandError(
        "VERSION_CONFLICT",
        `Товар изменился после формирования команды (сейчас остаток ${before.stock}). Откройте товар заново.`,
        { currentVersion: before.version, currentStock: before.stock },
      );
    }
    const updated = await tx.product.updateMany({
      where: { id: input.productId, version: input.expectedVersion },
      data: { stock: input.stock, version: { increment: 1 } },
    });
    if (updated.count === 0) {
      throw new AdminCommandError("VERSION_CONFLICT", "Товар изменился параллельно во время записи. Откройте товар заново.");
    }
    const after = await tx.product.findUniqueOrThrow({ where: { id: input.productId } });
    await tx.stockChangeLog.create({
      data: {
        productId: before.id,
        productTitle: before.title,
        oldStock: before.stock,
        newStock: after.stock,
        delta: after.stock - before.stock,
        source: actor.source,
        actorUserId: actor.userId,
        actorTelegramUserId: meta.actorTelegramUserId ?? null,
        confirmationId: meta.confirmationId ?? null,
      },
    });
    await writeAuditLog(tx, actor, {
      action: "SET_STOCK",
      entityType: "Product",
      entityId: before.id,
      before: { stock: before.stock },
      after: { stock: after.stock },
    });
    return after;
  });
}
