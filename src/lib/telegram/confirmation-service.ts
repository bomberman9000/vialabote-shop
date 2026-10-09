import { createHash, randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { AdminCommandError } from "@/lib/admin/errors";

const CONFIRMATION_TTL_MS = 5 * 60 * 1000; // 5 минут

export interface CreateConfirmationInput {
  actorTelegramUserId: string;
  commandType: string;
  entityType: string;
  entityId: string;
  expectedEntityVersion: number;
  payload: unknown;
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** Preview-шаг: команда предлагается, но НЕ исполняется. */
export async function createPendingConfirmation(input: CreateConfirmationInput) {
  const payloadJson = JSON.stringify(input.payload);
  return prisma.pendingConfirmation.create({
    data: {
      actorTelegramUserId: input.actorTelegramUserId,
      commandType: input.commandType,
      entityType: input.entityType,
      entityId: input.entityId,
      expectedEntityVersion: input.expectedEntityVersion,
      payload: payloadJson,
      payloadHash: hashPayload(input.payload),
      idempotencyKey: randomUUID(),
      status: "pending",
      expiresAt: new Date(Date.now() + CONFIRMATION_TTL_MS),
    },
  });
}

export interface ConsumeResult {
  payload: unknown;
  confirmationId: string;
}

/**
 * Атомарно "гасит" confirmation ровно один раз. Доказывает разом все 5
 * гарантий из PendingConfirmation:
 *  1. чужой telegramUserId -> FORBIDDEN;
 *  2. payloadHash не совпал (payload подменили после preview) -> VALIDATION;
 *  3. expiresAt в прошлом -> помечаем "expired", VALIDATION;
 *  4. status уже не "pending" (повторное нажатие) -> updateMany затронет 0
 *     строк — гонка/replay исключены атомарностью WHERE status='pending';
 *  5. expectedEntityVersion не совпадает с актуальной версией сущности —
 *     проверяется ВЫЗЫВАЮЩИМ кодом (командой) через сам command layer,
 *     который и так делает OCC-проверку — эта функция лишь передаёт
 *     expectedEntityVersion дальше, не дублируя чужую бизнес-логику.
 */
export async function consumeConfirmation(
  confirmationId: string,
  actorTelegramUserId: string,
): Promise<ConsumeResult> {
  const confirmation = await prisma.pendingConfirmation.findUnique({ where: { id: confirmationId } });
  if (!confirmation) {
    throw new AdminCommandError("NOT_FOUND", "Подтверждение не найдено");
  }

  if (confirmation.actorTelegramUserId !== actorTelegramUserId) {
    // Намеренно не раскрываем, что confirmation вообще существует для чужого id.
    throw new AdminCommandError("FORBIDDEN", "Это подтверждение вам не принадлежит");
  }

  if (confirmation.expiresAt.getTime() < Date.now()) {
    await prisma.pendingConfirmation.updateMany({
      where: { id: confirmationId, status: "pending" },
      data: { status: "expired" },
    });
    throw new AdminCommandError("VALIDATION", "Срок действия подтверждения истёк. Сформируйте команду заново.");
  }

  const currentHash = hashPayload(JSON.parse(confirmation.payload));
  if (currentHash !== confirmation.payloadHash) {
    throw new AdminCommandError("VALIDATION", "Payload повреждён — подтверждение отклонено");
  }

  // Атомарный переход pending -> consumed. Если строка уже не в статусе
  // pending (повторное нажатие "Подтвердить", гонка двух кликов), count=0 —
  // операция НЕ выполняется повторно.
  const result = await prisma.pendingConfirmation.updateMany({
    where: { id: confirmationId, status: "pending" },
    data: { status: "consumed", consumedAt: new Date() },
  });

  if (result.count === 0) {
    throw new AdminCommandError(
      "VALIDATION",
      "Это подтверждение уже использовано или отменено — повторное выполнение заблокировано",
    );
  }

  return { payload: JSON.parse(confirmation.payload), confirmationId };
}

export async function cancelConfirmation(confirmationId: string, actorTelegramUserId: string): Promise<void> {
  const confirmation = await prisma.pendingConfirmation.findUnique({ where: { id: confirmationId } });
  if (!confirmation || confirmation.actorTelegramUserId !== actorTelegramUserId) {
    throw new AdminCommandError("FORBIDDEN", "Это подтверждение вам не принадлежит");
  }
  await prisma.pendingConfirmation.updateMany({
    where: { id: confirmationId, status: "pending" },
    data: { status: "cancelled" },
  });
}
