// «Жду ввод от владельца»: после нажатия «Ввести число»/«Изменить название» бот ждёт следующее
// сообщение. Состояние хранится в PendingConfirmation со статусом "awaiting_input" (отдельная
// таблица/миграция не нужна): привязано к числовому Telegram id, живёт 10 минут, гасится атомарно.
import { createHash, randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";

export const INPUT_TTL_MS = 10 * 60 * 1000;
export const AWAITING = "awaiting_input";
export type InputKind = "INPUT_STOCK" | "INPUT_FIELD" | "INPUT_PHOTO";

export interface AwaitingInput {
  id: string;
  kind: InputKind;
  productId: string;
  version: number;
  payload: Record<string, unknown>;
}

/** Открыть ожидание ввода; предыдущие ожидания этого же человека отменяются (ждём одно). */
export async function openInput(
  actorTelegramUserId: string,
  kind: InputKind,
  productId: string,
  version: number,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await prisma.pendingConfirmation.updateMany({
    where: { actorTelegramUserId, status: AWAITING },
    data: { status: "cancelled" },
  });
  const json = JSON.stringify(payload);
  await prisma.pendingConfirmation.create({
    data: {
      actorTelegramUserId,
      commandType: kind,
      entityType: "Product",
      entityId: productId,
      expectedEntityVersion: version,
      payload: json,
      payloadHash: createHash("sha256").update(json).digest("hex"),
      idempotencyKey: randomUUID(),
      status: AWAITING,
      expiresAt: new Date(Date.now() + INPUT_TTL_MS),
    },
  });
}

/** Что сейчас ждём от этого человека (не просрочено); null — ничего. Состояние не меняет. */
export async function peekInput(actorTelegramUserId: string): Promise<AwaitingInput | null> {
  const row = await prisma.pendingConfirmation.findFirst({
    where: { actorTelegramUserId, status: AWAITING, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  return {
    id: row.id,
    kind: row.commandType as InputKind,
    productId: row.entityId,
    version: row.expectedEntityVersion,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
  };
}

/** Закрыть ожидание после принятого ввода. true — закрыли мы (повторное сообщение не пройдёт дважды). */
export async function closeInput(id: string): Promise<boolean> {
  const r = await prisma.pendingConfirmation.updateMany({
    where: { id, status: AWAITING },
    data: { status: "consumed", consumedAt: new Date() },
  });
  return r.count === 1;
}

export async function cancelInputs(actorTelegramUserId: string): Promise<void> {
  await prisma.pendingConfirmation.updateMany({
    where: { actorTelegramUserId, status: AWAITING },
    data: { status: "cancelled" },
  });
}
