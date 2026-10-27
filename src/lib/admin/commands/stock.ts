import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { AdminActor } from "../actor";
import { authorizeAdmin } from "../authorize";
import { writeAuditLog } from "../audit";
import { AdminCommandError } from "../errors";
import { adjustStock, MAX_STOCK, StockError } from "@/lib/stock/movements";

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
 * Ручная правка остатка (бот, годится и для Web Admin): проверка прав + adjustStock
 * (OCC по version, правка + StockChangeLog ADJUST) + AuditLog — всё в ОДНОЙ транзакции.
 * Если журнал не записался (например, миграция ещё не применена), остаток не меняется.
 */
export async function setStock(actor: AdminActor, rawInput: unknown, meta: SetStockMeta = {}) {
  await authorizeAdmin(actor);
  const input = setStockSchema.parse(rawInput);

  try {
    return await prisma.$transaction(async (tx) => {
      const { before, after } = await adjustStock(tx, {
        productId: input.productId,
        expectedVersion: input.expectedVersion,
        newStock: input.stock,
        source: actor.source,
        actorUserId: actor.userId,
        actorTelegramUserId: meta.actorTelegramUserId,
        confirmationId: meta.confirmationId,
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
  } catch (err) {
    if (err instanceof StockError) {
      const code = err.code === "NOT_FOUND" ? "NOT_FOUND" : err.code === "VERSION_CONFLICT" ? "VERSION_CONFLICT" : "VALIDATION";
      throw new AdminCommandError(code, err.message, err.details);
    }
    throw err;
  }
}
