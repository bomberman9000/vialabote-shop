// @vitest-environment node
// Маршрут webhook целиком (POST -> ответ Bot API), но с in-memory Prisma: проверяет без PostgreSQL,
// что КАЖДАЯ кнопка меню отвечает, правки идут только через подтверждение, журнал остатков
// пишется, а чужие id получают «Нет доступа». DB-версии этих проверок — panel.test.ts/poller.test.ts.
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { FakeDb } = await import("./__fixtures__/fake-prisma");
  return { prisma: new FakeDb() };
});

import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/telegram/webhook/route";
import { menuScreen, cb, SCREENS } from "./panel";
import { buildAction } from "./callbacks";
import type { FakeDb } from "./__fixtures__/fake-prisma";

const db = prisma as unknown as FakeDb;
const SECRET = "flows-secret";
const OWNER = 111000111;
const DB_ADMIN_NOT_OWNER = 222000222;
const STRANGER = 333000333;
const ORIGINAL = { ...process.env };

function post(update: unknown) {
  return POST(
    new Request("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET },
      body: JSON.stringify(update),
    }),
  ).then((r) => r.json());
}
const say = (from: number, text: string) => post({ update_id: 1, message: { message_id: 10, chat: { id: from, type: "private" }, from: { id: from }, text } });
const press = (from: number, data: string) =>
  post({ update_id: 2, callback_query: { id: "cq", from: { id: from }, message: { message_id: 55, chat: { id: from, type: "private" } }, data } });
const buttons = (body: any): { text: string; callback_data: string }[] => body.reply_markup?.inline_keyboard?.flat() ?? [];
const button = (body: any, re: RegExp) => {
  const b = buttons(body).find((x) => re.test(x.text));
  if (!b) throw new Error(`no button ${re} in ${JSON.stringify(buttons(body).map((x) => x.text))}`);
  return b.callback_data;
};

let PID = "";

beforeEach(async () => {
  for (const m of [db.user, db.product, db.order, db.orderItem, db.pendingConfirmation, db.stockChangeLog, db.auditLog]) m.rows.length = 0;
  process.env.TELEGRAM_BOT_TOKEN = "123:flows_token_not_real";
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  process.env.TELEGRAM_ADMIN_IDS = String(OWNER);
  await db.user.create({ data: { id: "u-owner", email: "o@x", role: "ADMIN", telegramUserId: String(OWNER) } });
  await db.user.create({ data: { id: "u-admin2", email: "a@x", role: "ADMIN", telegramUserId: String(DB_ADMIN_NOT_OWNER) } });
  const p = await db.product.create({
    data: { id: "clxprod0000000000000000001", title: "Крем Тест", slug: "krem", price: 219000, stock: 5, status: "published", description: "Описание", imageUrl: "/x.png" },
  });
  PID = p.id;
  await db.order.create({ data: { id: "o1", number: "1001", status: "PAID", totalAmount: 438000, deliveryCity: "Москва", createdAt: new Date() } });
  await db.orderItem.create({ data: { orderId: "o1", productId: PID, title: "Крем Тест", price: 219000, quantity: 2 } });
});

afterAll(() => {
  process.env = ORIGINAL;
});

describe("every menu button answers (owner)", () => {
  it.each(menuScreen().keyboard.flat().map((b) => [b.text, b.callback_data]))("%s -> editMessageText with a screen", async (_label, data) => {
    const body = await press(OWNER, data);
    expect(body).toMatchObject({ method: "editMessageText", chat_id: OWNER, message_id: 55 });
    expect(body.text.length).toBeGreaterThan(10);
    expect(body.text.length).toBeLessThanOrEqual(4096);
    for (const b of buttons(body)) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
  });

  it("covers all seven sections", () => {
    expect(menuScreen().keyboard.flat().map((b) => b.callback_data).sort()).toEqual(SCREENS.filter((s) => s !== "menu").map((s) => cb(s)).sort());
  });

  it("stats: period buttons switch day / week / month", async () => {
    const week = await press(OWNER, cb("stats"));
    expect(week.text).toContain("неделя");
    expect(week.text).toContain("Выручка: ");
    expect(week.text).toContain("Средний чек");
    expect(week.text).toContain("1. Крем Тест — 2 шт.");
    for (const [label, word] of [[/День/, "день"], [/Месяц/, "месяц"]] as const) {
      const body = await press(OWNER, button(week, label));
      expect(body.method).toBe("editMessageText");
      expect(body.text).toContain(`Статистика — ${word}`);
    }
  });

  it("a stale/unknown button gets a short answer instead of silence", async () => {
    for (const data of ["v2:nope:0", "a:zz:1", "a:se:bad id:1"]) {
      const body = await press(OWNER, data);
      expect(body).toMatchObject({ method: "answerCallbackQuery", callback_query_id: "cq" });
      expect(body.text).toContain("устарела");
    }
  });
});

describe("access: owner list only", () => {
  it.each([STRANGER, DB_ADMIN_NOT_OWNER])("id %s: «Нет доступа» on message and on every button", async (id) => {
    expect((await say(id, "/start")).text).toContain("Нет доступа");
    expect((await say(id, "12")).text).toContain("Нет доступа");
    for (const data of [cb("stats"), buildAction({ op: "stockApply", productId: PID, draft: 9 })]) {
      expect(await press(id, data)).toMatchObject({ method: "answerCallbackQuery", text: "Нет доступа", show_alert: true });
    }
    expect(db.pendingConfirmation.rows).toHaveLength(0);
  });

  it("empty TELEGRAM_ADMIN_IDS: DB ADMIN may look, but every write is off", async () => {
    process.env.TELEGRAM_ADMIN_IDS = "";
    const menu = await say(OWNER, "/start");
    expect(menu.text).toContain("только просмотр");
    const card = await press(OWNER, buildAction({ op: "card", productId: PID }));
    expect(card.text).toContain("правки отключены");
    expect(buttons(card).some((b) => b.callback_data.startsWith("a:se:"))).toBe(false);
    const forged = await press(OWNER, buildAction({ op: "stockApply", productId: PID, draft: 99 }));
    expect(forged).toMatchObject({ method: "answerCallbackQuery", show_alert: true });
    expect(forged.text).toContain("отключены");
    expect(db.pendingConfirmation.rows).toHaveLength(0);
    expect(db.product.rows[0].stock).toBe(5);
  });
});

describe("stock editing", () => {
  it("buttons +/-, preview, confirm -> stock written + change log (who, when, was, became)", async () => {
    const stock = await press(OWNER, cb("stock"));
    const editor = await press(OWNER, button(stock, /Крем Тест/));
    expect(editor.text).toContain("Сейчас в базе: 5 шт.");
    const plus10 = await press(OWNER, button(editor, /^\+10$/));
    const minus1 = await press(OWNER, button(plus10, /^-1$/));
    expect(minus1.text).toContain("Новое значение: 14 шт. (+9)");
    expect(db.product.rows[0].stock).toBe(5); // кнопки ничего не пишут

    const preview = await press(OWNER, button(minus1, /Применить: 5 → 14/));
    expect(preview.text).toContain("было: 5 шт.\nстанет: 14 шт. (+9)");
    expect(db.product.rows[0].stock).toBe(5); // предпросмотр ничего не пишет

    const done = await press(OWNER, button(preview, /Подтвердить/));
    expect(done.text).toContain("теперь 14 шт.");
    expect(db.product.rows[0]).toMatchObject({ stock: 14, version: 2 });
    expect(db.stockChangeLog.rows).toHaveLength(1);
    expect(db.stockChangeLog.rows[0]).toMatchObject({
      productId: PID,
      oldStock: 5,
      newStock: 14,
      delta: 9,
      source: "TELEGRAM",
      actorUserId: "u-owner",
      actorTelegramUserId: String(OWNER),
    });
    expect(db.stockChangeLog.rows[0].createdAt).toBeInstanceOf(Date);
    expect(db.auditLog.rows.map((r) => r.action)).toEqual(["SET_STOCK"]);

    // повторное нажатие «Подтвердить» не пишет второй раз
    const again = await press(OWNER, button(preview, /Подтвердить/));
    expect(again.text).toContain("уже использовано");
    expect(db.stockChangeLog.rows).toHaveLength(1);
  });

  it("typed number: invalid input re-asks, valid input -> preview -> cancel leaves stock as is", async () => {
    await press(OWNER, buildAction({ op: "stockInput", productId: PID }));
    expect((await say(OWNER, "-10")).text).toContain("отрицательным");
    const preview = await say(OWNER, "+3");
    expect(preview.text).toContain("было: 5 шт.\nстанет: 8 шт. (+3)");
    const cancel = await press(OWNER, button(preview, /Отмена/));
    expect(cancel.text).toContain("Отменено");
    expect(db.product.rows[0].stock).toBe(5);
    expect(db.stockChangeLog.rows).toHaveLength(0);
  });

  it("stale preview (product changed meanwhile) is refused by the version check", async () => {
    const preview = await press(OWNER, buildAction({ op: "stockApply", productId: PID, draft: 1 }));
    db.product.rows[0].version = 7; // кто-то поменял товар в Web Admin
    const done = await press(OWNER, button(preview, /Подтвердить/));
    expect(done.text).toMatch(/изменился/);
    expect(db.product.rows[0].stock).toBe(5);
    expect(db.stockChangeLog.rows).toHaveLength(0);
  });

  it("/menu cancels a pending number input", async () => {
    await press(OWNER, buildAction({ op: "stockInput", productId: PID }));
    await say(OWNER, "/menu");
    const r = await say(OWNER, "12");
    expect(r.text).not.toContain("станет");
  });
});

describe("card editing", () => {
  it("title: prompt -> text -> preview -> confirm -> written via updateProduct", async () => {
    const card = await press(OWNER, buildAction({ op: "card", productId: PID }));
    const prompt = await press(OWNER, button(card, /Название/));
    expect(prompt.text).toContain("Отправьте новое название");
    const preview = await say(OWNER, "Крем Новый");
    expect(preview.text).toContain("было: Крем Тест\nстанет: Крем Новый");
    expect(db.product.rows[0].title).toBe("Крем Тест");
    const done = await press(OWNER, button(preview, /Подтвердить/));
    expect(done.text).toContain("Карточка обновлена");
    expect(db.product.rows[0].title).toBe("Крем Новый");
    expect(db.auditLog.rows.map((r) => r.action)).toEqual(["UPDATE_PRODUCT"]);
  });

  it("price in rubles -> kopecks; INCI and description", async () => {
    await press(OWNER, buildAction({ op: "field", productId: PID, field: "price" }));
    expect((await say(OWNER, "0")).text).toContain("больше нуля");
    const p = await say(OWNER, "2 500");
    await press(OWNER, button(p, /Подтвердить/));
    expect(db.product.rows[0].price).toBe(250000);

    await press(OWNER, buildAction({ op: "field", productId: PID, field: "inci" }));
    await press(OWNER, button(await say(OWNER, "Aqua, Glycerin"), /Подтвердить/));
    expect(db.product.rows[0].activeIngredients).toBe("Aqua, Glycerin");

    await press(OWNER, buildAction({ op: "field", productId: PID, field: "desc" }));
    await press(OWNER, button(await say(OWNER, "Новое описание"), /Подтвердить/));
    expect(db.product.rows[0].description).toBe("Новое описание");
  });

  it("visibility: published -> draft with preview and confirmation", async () => {
    const menu = await press(OWNER, buildAction({ op: "visMenu", productId: PID }));
    const preview = await press(OWNER, button(menu, /скрыт/));
    expect(preview.text).toContain("было: виден на сайте\nстанет: скрыт (черновик)");
    expect(db.product.rows[0].status).toBe("published");
    await press(OWNER, button(preview, /Подтвердить/));
    expect(db.product.rows[0]).toMatchObject({ status: "draft", isActive: false });
  });

  it("photo: bad file is refused before any confirmation", async () => {
    await press(OWNER, buildAction({ op: "photo", productId: PID }));
    const r = await post({
      update_id: 3,
      message: { message_id: 11, chat: { id: OWNER, type: "private" }, from: { id: OWNER }, document: { file_id: "F1", mime_type: "application/pdf" } },
    });
    expect(r.text).toContain("JPEG, PNG или WebP");
    expect(db.pendingConfirmation.rows.filter((c) => c.status === "pending")).toHaveLength(0);
  });
});
