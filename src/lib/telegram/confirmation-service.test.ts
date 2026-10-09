import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createPendingConfirmation, consumeConfirmation, cancelConfirmation } from "./confirmation-service";
import { AdminCommandError } from "@/lib/admin/errors";

const createdIds: string[] = [];

afterEach(async () => {
  await prisma.pendingConfirmation.deleteMany({ where: { id: { in: createdIds.splice(0) } } });
});

const TELEGRAM_USER = "123456789";
const OTHER_TELEGRAM_USER = "987654321";

function samplePayload() {
  return { productId: "p1", type: "percent" as const, value: 15 };
}

describe("createPendingConfirmation", () => {
  it("создаёт запись со статусом pending и хэшем payload", async () => {
    const c = await createPendingConfirmation({
      actorTelegramUserId: TELEGRAM_USER,
      commandType: "SET_DISCOUNT",
      entityType: "Product",
      entityId: "p1",
      expectedEntityVersion: 3,
      payload: samplePayload(),
    });
    createdIds.push(c.id);
    expect(c.status).toBe("pending");
    expect(c.payloadHash).toHaveLength(64); // sha256 hex
  });
});

describe("consumeConfirmation — 5 гарантий", () => {
  it("1. чужой telegramUserId не может подтвердить (FORBIDDEN)", async () => {
    const c = await createPendingConfirmation({
      actorTelegramUserId: TELEGRAM_USER,
      commandType: "SET_DISCOUNT",
      entityType: "Product",
      entityId: "p1",
      expectedEntityVersion: 1,
      payload: samplePayload(),
    });
    createdIds.push(c.id);

    await expect(consumeConfirmation(c.id, OTHER_TELEGRAM_USER)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const stillPending = await prisma.pendingConfirmation.findUniqueOrThrow({ where: { id: c.id } });
    expect(stillPending.status).toBe("pending"); // чужая попытка не изменила состояние
  });

  it("2. подменённый payload (payloadHash не совпадает) отклоняется", async () => {
    const c = await createPendingConfirmation({
      actorTelegramUserId: TELEGRAM_USER,
      commandType: "SET_DISCOUNT",
      entityType: "Product",
      entityId: "p1",
      expectedEntityVersion: 1,
      payload: samplePayload(),
    });
    createdIds.push(c.id);

    // Симулируем подмену payload в БД напрямую (напр. если бы кто-то смог
    // отредактировать строку) — hash больше не совпадает с содержимым.
    await prisma.pendingConfirmation.update({
      where: { id: c.id },
      data: { payload: JSON.stringify({ productId: "p1", type: "percent", value: 90 }) },
    });

    await expect(consumeConfirmation(c.id, TELEGRAM_USER)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("3. просроченное подтверждение (TTL) отклоняется и помечается expired", async () => {
    const c = await createPendingConfirmation({
      actorTelegramUserId: TELEGRAM_USER,
      commandType: "SET_DISCOUNT",
      entityType: "Product",
      entityId: "p1",
      expectedEntityVersion: 1,
      payload: samplePayload(),
    });
    createdIds.push(c.id);
    await prisma.pendingConfirmation.update({
      where: { id: c.id },
      data: { expiresAt: new Date(Date.now() - 1000) }, // уже истекло
    });

    await expect(consumeConfirmation(c.id, TELEGRAM_USER)).rejects.toMatchObject({ code: "VALIDATION" });
    const after = await prisma.pendingConfirmation.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.status).toBe("expired");
  });

  it("4. повторное подтверждение (replay) не выполняется дважды", async () => {
    const c = await createPendingConfirmation({
      actorTelegramUserId: TELEGRAM_USER,
      commandType: "SET_DISCOUNT",
      entityType: "Product",
      entityId: "p1",
      expectedEntityVersion: 1,
      payload: samplePayload(),
    });
    createdIds.push(c.id);

    const first = await consumeConfirmation(c.id, TELEGRAM_USER);
    expect(first.payload).toEqual(samplePayload());

    // Повторное нажатие "Подтвердить" на ту же confirmation.
    await expect(consumeConfirmation(c.id, TELEGRAM_USER)).rejects.toMatchObject({ code: "VALIDATION" });

    const finalState = await prisma.pendingConfirmation.findUniqueOrThrow({ where: { id: c.id } });
    expect(finalState.status).toBe("consumed");
    expect(finalState.consumedAt).not.toBeNull();
  });

  it("параллельные подтверждения одной и той же записи — консистентно исполняется только одно", async () => {
    const c = await createPendingConfirmation({
      actorTelegramUserId: TELEGRAM_USER,
      commandType: "SET_DISCOUNT",
      entityType: "Product",
      entityId: "p1",
      expectedEntityVersion: 1,
      payload: samplePayload(),
    });
    createdIds.push(c.id);

    const results = await Promise.allSettled([
      consumeConfirmation(c.id, TELEGRAM_USER),
      consumeConfirmation(c.id, TELEGRAM_USER),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBe(1); // ровно одно выполнилось
  });

  it("5. передаёт expectedEntityVersion наружу — вызывающий command layer делает OCC-проверку", async () => {
    const c = await createPendingConfirmation({
      actorTelegramUserId: TELEGRAM_USER,
      commandType: "SET_DISCOUNT",
      entityType: "Product",
      entityId: "p1",
      expectedEntityVersion: 7,
      payload: samplePayload(),
    });
    createdIds.push(c.id);
    expect(c.expectedEntityVersion).toBe(7);
  });
});

describe("cancelConfirmation", () => {
  it("отменяет pending confirmation", async () => {
    const c = await createPendingConfirmation({
      actorTelegramUserId: TELEGRAM_USER,
      commandType: "SET_DISCOUNT",
      entityType: "Product",
      entityId: "p1",
      expectedEntityVersion: 1,
      payload: samplePayload(),
    });
    createdIds.push(c.id);
    await cancelConfirmation(c.id, TELEGRAM_USER);
    const after = await prisma.pendingConfirmation.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.status).toBe("cancelled");

    await expect(consumeConfirmation(c.id, TELEGRAM_USER)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("чужой пользователь не может отменить", async () => {
    const c = await createPendingConfirmation({
      actorTelegramUserId: TELEGRAM_USER,
      commandType: "SET_DISCOUNT",
      entityType: "Product",
      entityId: "p1",
      expectedEntityVersion: 1,
      payload: samplePayload(),
    });
    createdIds.push(c.id);
    await expect(cancelConfirmation(c.id, OTHER_TELEGRAM_USER)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
