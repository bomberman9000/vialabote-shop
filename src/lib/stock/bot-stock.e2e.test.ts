// @vitest-environment node
// E2E «бот + склад» на одной in-memory базе: правка остатка через webhook-маршрут бота ->
// резерв заказом сайта -> отмена (возврат резерва) -> повтор вебхука -> второй заказ оплачен.
// Сходятся: Product.stock, строки StockChangeLog и инвариант «начальный остаток + Σdelta = текущий».
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { FakeDb } = await import("@/lib/telegram/__fixtures__/fake-prisma");
  return { prisma: new FakeDb() };
});

import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/telegram/webhook/route";
import { buildAction } from "@/lib/telegram/callbacks";
import type { FakeDb } from "@/lib/telegram/__fixtures__/fake-prisma";
import { commitOrder, releaseOrder, reserveForOrder, type Tx } from "./movements";

const db = prisma as unknown as FakeDb;
const SECRET = "e2e-secret";
const OWNER = 555000555;
const PID = "clxe2e00000000000000000001";
const ORIGINAL = { ...process.env };

const press = (data: string) =>
  POST(
    new Request("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET },
      body: JSON.stringify({ update_id: 1, callback_query: { id: "cq", from: { id: OWNER }, message: { message_id: 7, chat: { id: OWNER, type: "private" } }, data } }),
    }),
  ).then((r) => r.json());
const confirmOf = (body: any) => body.reply_markup.inline_keyboard.flat().find((b: any) => /Подтвердить/.test(b.text)).callback_data as string;
const stock = () => db.product.rows.find((p) => p.id === PID)!.stock as number;
const journal = () => db.stockChangeLog.rows.map((r) => `${r.reason}:${r.delta >= 0 ? "+" : ""}${r.delta}:${r.source}${r.orderId ? `:${r.orderId}` : ""}`);
const sumDelta = () => db.stockChangeLog.rows.reduce((a, r) => a + r.delta, 0);

/** Как будет звать сайт (сессия vialabote-legal): заказ и резерв в одной транзакции. */
const placeOrder = (orderId: string, quantity: number) =>
  prisma.$transaction(async (tx) => {
    await tx.order.create({
      data: {
        id: orderId,
        number: orderId,
        status: "AWAITING_PAYMENT",
        totalAmount: quantity * 219000,
        customerName: "Тест",
        customerEmail: "t@example.com",
        customerPhone: "+70000000000",
        deliveryCity: "Москва",
        deliveryAddress: "—",
      },
    });
    return reserveForOrder(tx as unknown as Tx, { orderId, items: [{ productId: PID, quantity }] });
  });
const cancelOrder = (orderId: string) =>
  prisma.$transaction(async (tx) => {
    await tx.order.updateMany({ where: { id: orderId }, data: { status: "CANCELLED" } });
    return releaseOrder(tx as unknown as Tx, { orderId });
  });
const payOrder = (orderId: string) =>
  prisma.$transaction(async (tx) => {
    await tx.order.updateMany({ where: { id: orderId }, data: { status: "PAID" } });
    return commitOrder(tx as unknown as Tx, { orderId });
  });

beforeAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = "1:e2e_not_real";
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  process.env.TELEGRAM_ADMIN_IDS = String(OWNER);
  await db.user.create({ data: { id: "u-owner", email: "o@x", role: "ADMIN", telegramUserId: String(OWNER) } });
  await db.product.create({ data: { id: PID, title: "Крем E2E", slug: "e2e", price: 219000, stock: 2, status: "published", description: "d", imageUrl: "/x.png" } });
});
afterAll(() => {
  process.env = ORIGINAL;
});

describe("bot + warehouse end to end", () => {
  const INITIAL = 2;

  it("1. owner sets stock 2 -> 5 in the bot (ADJUST)", async () => {
    const preview = await press(buildAction({ op: "stockApply", productId: PID, draft: 5 }));
    expect(preview.text).toContain("было: 2 шт.\nстанет: 5 шт. (+3)");
    const done = await press(confirmOf(preview));
    expect(done.text).toContain("теперь 5 шт.");
    expect(stock()).toBe(5);
    expect(journal()).toEqual(["ADJUST:+3:TELEGRAM"]);
  });

  it("2. site order A reserves 3 -> stock 2; the bot sees it; a bot preview made before is now stale", async () => {
    const stalePreview = await press(buildAction({ op: "stockApply", productId: PID, draft: 9 })); // до заказа
    await placeOrder("A", 3);
    expect(stock()).toBe(2);
    const card = await press(buildAction({ op: "card", productId: PID }));
    expect(card.text).toContain("Остаток: 2 шт.");
    const stale = await press(confirmOf(stalePreview));
    expect(stale.text).toMatch(/изменился/); // резерв не перезаписан старой правкой
    expect(stock()).toBe(2);
  });

  it("3. order B wants 3 but only 2 left: refused, order B not created, nothing changed", async () => {
    await expect(placeOrder("B", 3)).rejects.toMatchObject({ code: "OUT_OF_STOCK", details: { available: 2, requested: 3 } });
    expect(db.order.rows.map((o) => o.id)).toEqual(["A"]);
    expect(stock()).toBe(2);
  });

  it("4. order A cancelled -> reserve returned (RELEASE) -> stock 5; webhook retry returns nothing twice", async () => {
    expect((await cancelOrder("A")).released).toEqual([{ productId: PID, quantity: 3, stockAfter: 5 }]);
    expect((await cancelOrder("A")).alreadyReleased).toEqual([PID]);
    expect(stock()).toBe(5);
  });

  it("5. order C reserves 4 and is paid (WRITE_OFF, delta 0); a late cancel does not return it", async () => {
    await placeOrder("C", 4);
    expect((await payOrder("C")).committed).toEqual([PID]);
    expect((await payOrder("C")).alreadyCommitted).toEqual([PID]);
    expect((await cancelOrder("C")).committed).toEqual([PID]);
    expect(stock()).toBe(1);
  });

  it("6. totals reconcile: stock, journal rows and Σdelta", () => {
    expect(journal()).toEqual([
      "ADJUST:+3:TELEGRAM",
      "RESERVE:-3:SITE_ORDER:A",
      "RELEASE:+3:PAYMENT_WEBHOOK:A",
      "RESERVE:-4:SITE_ORDER:C",
      "WRITE_OFF:+0:PAYMENT_WEBHOOK:C",
    ]);
    expect(INITIAL + sumDelta()).toBe(stock());
    expect(stock()).toBe(1);
    // журнал непрерывен: каждая строка начинается с остатка, которым закончилась предыдущая
    const rows = db.stockChangeLog.rows;
    for (let i = 1; i < rows.length; i++) expect(rows[i].oldStock).toBe(rows[i - 1].newStock);
    expect(db.auditLog.rows.map((r) => r.action)).toEqual(["SET_STOCK"]);
  });
});
