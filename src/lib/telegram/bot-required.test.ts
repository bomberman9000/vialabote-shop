// @vitest-environment node
// Обязательные сценарии бота (без БД, без реальных токенов): +1, −1 без ухода в минус, ввод числа,
// картинка (принята и отклонена), неверный секрет webhook. Чужой id, конкурентная правка и гонка
// отмены/оплаты — в panel-flows.test.ts и src/lib/stock/movements.pg.test.ts.
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { FakeDb } = await import("./__fixtures__/fake-prisma");
  return { prisma: new FakeDb() };
});
// Медиа-хранилище в памяти: тест не пишет файлы в public/uploads.
const saved: { key: string; bytes: number }[] = [];
vi.mock("@/lib/media/local-storage", () => ({
  extensionForMime: (m: string) => (m === "image/png" ? "png" : m === "image/webp" ? "webp" : "jpg"),
  LocalMediaStorage: class {
    async save(bytes: Uint8Array, ext: string) {
      const key = `mem-${saved.length + 1}.${ext}`;
      saved.push({ key, bytes: bytes.byteLength });
      return { storageKey: key, url: `/uploads/media/${key}` };
    }
    async delete() {}
  },
}));

import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/telegram/webhook/route";
import { buildAction } from "./callbacks";
import { makePngBytes } from "@/lib/media/test-fixtures";
import type { FakeDb } from "./__fixtures__/fake-prisma";

const db = prisma as unknown as FakeDb;
const SECRET = "required-fixture-secret";
const OWNER = 444000444;
const PID = "clxreq00000000000000000001";
const ORIGINAL = { ...process.env };
const realFetch = globalThis.fetch;

const call = (update: unknown, secret: string | null = SECRET) =>
  POST(
    new Request("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret === null ? {} : { "x-telegram-bot-api-secret-token": secret }) },
      body: JSON.stringify(update),
    }),
  );
const json = (update: unknown) => call(update).then((r) => r.json());
const press = (data: string) => json({ update_id: 1, callback_query: { id: "cq", from: { id: OWNER }, message: { message_id: 5, chat: { id: OWNER, type: "private" } }, data } });
const say = (text: string) => json({ update_id: 2, message: { message_id: 6, chat: { id: OWNER, type: "private" }, from: { id: OWNER }, text } });
const sendPhoto = (fileId: string) =>
  json({ update_id: 3, message: { message_id: 7, chat: { id: OWNER, type: "private" }, from: { id: OWNER }, photo: [{ file_id: `${fileId}-small`, width: 90, height: 90 }, { file_id: fileId, width: 1600, height: 1600 }] } });
const buttons = (b: any): { text: string; callback_data: string }[] => b.reply_markup?.inline_keyboard?.flat() ?? [];
const button = (b: any, re: RegExp) => {
  const x = buttons(b).find((y) => re.test(y.text));
  if (!x) throw new Error(`no button ${re}: ${JSON.stringify(buttons(b).map((y) => y.text))}`);
  return x.callback_data;
};
const product = () => db.product.rows.find((p) => p.id === PID)!;

/** Фиктивный Bot API: getFile -> путь, file/... -> байты картинки по file_id. */
function stubTelegramFiles(files: Record<string, Uint8Array>) {
  const urls: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    urls.push(url.replace(process.env.TELEGRAM_BOT_TOKEN!, "<token>"));
    if (url.endsWith("/getFile")) {
      const { file_id } = JSON.parse(String(init?.body));
      return Response.json({ ok: true, result: { file_path: `photos/${file_id}.png`, file_size: files[file_id]?.byteLength ?? 0 } });
    }
    const id = /photos\/(.+)\.png$/.exec(url)?.[1] ?? "";
    return files[id] ? new Response(new Uint8Array(files[id])) : new Response("nope", { status: 404 }); // копия: Uint8Array<ArrayBuffer> для BodyInit
  }) as typeof fetch;
  return urls;
}

beforeEach(async () => {
  for (const m of [db.user, db.category, db.product, db.pendingConfirmation, db.stockChangeLog, db.auditLog, db.mediaAsset]) m.rows.length = 0;
  saved.length = 0;
  globalThis.fetch = realFetch;
  process.env.TELEGRAM_BOT_TOKEN = "000:fixture_token_not_real";
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  process.env.TELEGRAM_ADMIN_IDS = String(OWNER);
  process.env.TELEGRAM_API_BASE = "http://tg.fixture";
  await db.user.create({ data: { id: "u-owner", email: "o@x", role: "ADMIN", telegramUserId: String(OWNER) } });
  await db.product.create({ data: { id: PID, title: "Сыворотка", slug: "s", price: 150000, stock: 1, status: "published", description: "d", imageUrl: "/images/placeholder.svg" } });
});
afterAll(() => {
  process.env = ORIGINAL;
  globalThis.fetch = realFetch;
});

describe("stock: +1, −1, typed number, never below zero", () => {
  it("+1 -> apply -> confirm: 1 -> 2, journal ADJUST +1", async () => {
    const editor = await press(buildAction({ op: "stockEdit", productId: PID, draft: 1 }));
    const plus = await press(button(editor, /^\+1$/));
    expect(plus.text).toContain("Новое значение: 2 шт. (+1)");
    const done = await press(button(await press(button(plus, /Применить: 1 → 2/)), /Подтвердить/));
    expect(done.text).toContain("теперь 2 шт.");
    expect(db.stockChangeLog.rows.map((r) => [r.reason, r.delta, r.oldStock, r.newStock])).toEqual([["ADJUST", 1, 1, 2]]);
  });

  it("−1 -> apply -> confirm: 1 -> 0; at 0 the −1 button stays at 0 and offers nothing to apply", async () => {
    const editor = await press(buildAction({ op: "stockEdit", productId: PID, draft: 1 }));
    const minus = await press(button(editor, /^-1$/));
    await press(button(await press(button(minus, /Применить: 1 → 0/)), /Подтвердить/));
    expect(product().stock).toBe(0);

    const atZero = await press(buildAction({ op: "stockEdit", productId: PID, draft: 0 }));
    const again = await press(button(atZero, /^-1$/));
    expect(again.text).toContain("Новое значение: 0 шт. (без изменений)");
    expect(buttons(again).some((b) => /Применить/.test(b.text))).toBe(false);
    expect(button(atZero, /^-10$/)).toBe(buildAction({ op: "stockEdit", productId: PID, draft: 0 }));
  });

  it("typed number: '-5' from 1 is refused (negative), '0' and '+4' are previewed", async () => {
    await press(buildAction({ op: "stockInput", productId: PID }));
    expect((await say("-5")).text).toContain("не может быть отрицательным");
    const p0 = await say("0");
    expect(p0.text).toContain("было: 1 шт.\nстанет: 0 шт. (-1)");
    await press(buildAction({ op: "stockInput", productId: PID }));
    const p4 = await say("+4");
    expect(p4.text).toContain("станет: 5 шт. (+4)");
    expect(product().stock).toBe(1); // ничего не записано без подтверждения
  });

  it("a forged negative draft in callback_data is rejected as a stale button", async () => {
    const r = await press(`a:sa:${PID}:-3`);
    expect(r).toMatchObject({ method: "answerCallbackQuery" });
    expect(r.text).toContain("устарела");
    expect(db.pendingConfirmation.rows).toHaveLength(0);
  });
});

describe("picture", () => {
  it("valid square photo: preview as a photo -> confirm -> main photo replaced, audit ATTACH_MEDIA", async () => {
    const urls = stubTelegramFiles({ OK: makePngBytes(1600, 1600) });
    await press(buildAction({ op: "photo", productId: PID }));
    const preview = await sendPhoto("OK");
    expect(preview).toMatchObject({ method: "sendPhoto", chat_id: OWNER, photo: "OK" }); // самый большой размер
    expect(preview.caption).toContain("1600×1600");
    expect(product().imageUrl).toBe("/images/placeholder.svg"); // до подтверждения ничего не меняется
    expect(saved).toHaveLength(0);

    const done = await press(button(preview, /Подтвердить/));
    expect(done.text).toContain("Главное фото заменено");
    expect(product().imageUrl).toBe("/uploads/media/mem-1.png");
    expect(db.mediaAsset.rows[0]).toMatchObject({ purpose: "PRODUCT_PRIMARY", isPrimary: true, productId: PID, width: 1600, height: 1600 });
    expect(db.auditLog.rows.map((r) => r.action)).toEqual(["ATTACH_MEDIA"]);
    expect(urls.every((u) => u.startsWith("http://tg.fixture/"))).toBe(true);
    expect(urls.join(" ")).not.toContain(process.env.TELEGRAM_BOT_TOKEN!);
  });

  it("too small / not square photo is refused before any confirmation", async () => {
    stubTelegramFiles({ SMALL: makePngBytes(800, 600) });
    await press(buildAction({ op: "photo", productId: PID }));
    const r = await sendPhoto("SMALL");
    expect(r.method).toBe("sendMessage");
    expect(r.text).toContain("Фото не подходит");
    expect(db.pendingConfirmation.rows.filter((c) => c.status === "pending")).toHaveLength(0);
    expect(product().imageUrl).toBe("/images/placeholder.svg");
  });

  it("Telegram file API failure -> clear message, nothing written", async () => {
    stubTelegramFiles({});
    await press(buildAction({ op: "photo", productId: PID }));
    const r = await sendPhoto("MISSING");
    expect(r.text).toContain("Не удалось скачать файл из Telegram");
    expect(saved).toHaveLength(0);
  });
});

describe("unauthorized API: webhook secret", () => {
  const forged = { update_id: 9, callback_query: { id: "cq", from: { id: OWNER }, message: { message_id: 5, chat: { id: OWNER, type: "private" } }, data: buildAction({ op: "stockApply", productId: PID, draft: 99 }) } };

  it.each([
    ["wrong secret", "not-the-secret"],
    ["missing header", null],
    ["empty header", ""],
  ])("%s -> 403, update not processed even with the owner's id", async (_n, secret) => {
    const res = await call(forged, secret);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(db.pendingConfirmation.rows).toHaveLength(0);
    expect(product().stock).toBe(1);
  });
});
