// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/telegram/webhook/route";
import { SCREENS, cb, isMenuCommand, menuScreen, parseCallback, catalogProblems, renderScreen } from "./panel";

const SECRET = "panel-test-secret";
const suffix = Date.now();
const ADMIN_TG = 700000000 + (suffix % 99999999);
const CUSTOMER_TG = ADMIN_TG + 1;
const STRANGER_TG = ADMIN_TG + 2;
const ORIGINAL = { token: process.env.TELEGRAM_BOT_TOKEN, secret: process.env.TELEGRAM_WEBHOOK_SECRET };

let categoryId: string;
const userIds: string[] = [];
const productIds: string[] = [];
const orderIds: string[] = [];

function post(update: unknown) {
  return POST(
    new Request("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET },
      body: JSON.stringify(update),
    }),
  );
}
const message = (from: number, text: string, chatType = "private") => ({
  update_id: 1,
  message: { message_id: 10, chat: { id: from, type: chatType }, from: { id: from }, text },
});
const press = (from: number, data: string, chatType = "private") => ({
  update_id: 2,
  callback_query: { id: "cq1", from: { id: from }, message: { message_id: 55, chat: { id: from, type: chatType } }, data },
});

/** Snapshot of this test's own records (other test files run in parallel on the same DB). */
async function dbFingerprint() {
  const [products, orders, users, confirmations, audit, discounts] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, title: true, price: true, stock: true, status: true, version: true, updatedAt: true }, orderBy: { id: "asc" } }),
    prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, status: true, totalAmount: true, updatedAt: true }, orderBy: { id: "asc" } }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, role: true, telegramUserId: true }, orderBy: { id: "asc" } }),
    prisma.pendingConfirmation.count({ where: { actorTelegramUserId: { in: [String(ADMIN_TG), String(CUSTOMER_TG)] } } }),
    prisma.auditLog.count({ where: { actorId: { in: userIds } } }),
    prisma.discount.count({ where: { productId: { in: productIds } } }),
  ]);
  return JSON.stringify({ products, orders, users, confirmations, audit, discounts });
}

describe("panel — parsing (no DB)", () => {
  it("menu commands", () => {
    expect(isMenuCommand("/start")).toBe("start");
    expect(isMenuCommand("/start@labote_cosmetic_bot")).toBe("start");
    expect(isMenuCommand(" /MENU ")).toBe("start");
    expect(isMenuCommand("/help")).toBe("help");
    expect(isMenuCommand("меню")).toBe("start");
    expect(isMenuCommand("помощь")).toBe("help");
    expect(isMenuCommand("показать товары без INCI")).toBeNull();
    expect(isMenuCommand("/startx")).toBeNull();
  });

  it("callback data round-trips and rejects anything else", () => {
    for (const s of SCREENS) expect(parseCallback(cb(s, 3))).toEqual({ screen: s, page: 3 });
    for (const bad of ["v2:orders", "v2:drop:1", "v2:orders:-1", "v2:orders:99999", "confirm:abc", "v2:orders:1:x", ""]) {
      expect(parseCallback(bad)).toBeNull();
    }
  });

  it("main menu has the six required buttons plus stock, all callback_data within 64 bytes", () => {
    const labels = menuScreen().keyboard.flat().map((b) => b.text);
    expect(labels).toEqual(expect.arrayContaining(["📦 Товары", "🛒 Заказы", "🧪 Составы INCI", "📊 Статистика", "⚠️ Проблемы каталога", "⚙️ Настройки"]));
    for (const b of menuScreen().keyboard.flat()) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
  });
});

describe("panel — read-only guard (no DB)", () => {
  it("panel.ts contains no Prisma write call at all (static guard)", () => {
    const src = fs.readFileSync(path.join(__dirname, "panel.ts"), "utf8");
    const writes = src.match(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany|executeRaw\w*|queryRaw\w*|\$transaction)\s*\(/g);
    expect(writes).toBeNull();
  });
});

describe("panel — through the real webhook route (DB)", () => {
  beforeAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123456789:panel_test_token_not_real_aaaaaaaa";
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    const c = await prisma.category.create({ data: { name: "TEST-Panel", slug: `test-panel-${suffix}` } });
    categoryId = c.id;
    for (const [role, tg] of [["ADMIN", ADMIN_TG], ["CUSTOMER", CUSTOMER_TG]] as const) {
      const u = await prisma.user.create({ data: { email: `panel-${role}-${suffix}@example.com`, passwordHash: "x", role, telegramUserId: String(tg) } });
      userIds.push(u.id);
    }
    const mk = (data: Record<string, unknown>) =>
      prisma.product.create({
        data: { title: `Panel ${suffix} ${data.slug}`, slug: `panel-${suffix}-${data.slug}`, description: "desc", price: 5000, imageUrl: "/images/x.png", categoryId, ...data } as never,
      });
    productIds.push((await mk({ slug: "ok", status: "published", isActive: true, stock: 20, activeIngredients: "Aqua" })).id);
    productIds.push((await mk({ slug: "noinci", status: "published", isActive: true, stock: 0, activeIngredients: null, imageUrl: "/images/placeholder.svg" })).id);
    const o = await prisma.order.create({
      data: {
        number: `P${suffix}`,
        status: "PAID",
        customerName: "Secret Person",
        customerEmail: `secret-${suffix}@example.com`,
        customerPhone: "+79990001122",
        deliveryCity: "Москва",
        deliveryAddress: "ул. Тайная, 1",
        totalAmount: 123400,
      },
    });
    orderIds.push(o.id);
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.category.delete({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    for (const [k, v] of [["TELEGRAM_BOT_TOKEN", ORIGINAL.token], ["TELEGRAM_WEBHOOK_SECRET", ORIGINAL.secret]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("/start for ADMIN: main menu with inline keyboard", async () => {
    const body = await (await post(message(ADMIN_TG, "/start"))).json();
    expect(body.method).toBe("sendMessage");
    expect(body.chat_id).toBe(ADMIN_TG);
    expect(body.text).toContain("только просмотр");
    expect(body.reply_markup.inline_keyboard.flat().map((b: { text: string }) => b.text)).toContain("📦 Товары");
  });

  it("/help for ADMIN: help text that states read-only + a menu button", async () => {
    const body = await (await post(message(ADMIN_TG, "/help"))).json();
    expect(body.text).toContain("/start");
    expect(body.text).toContain("нельзя");
    expect(body.reply_markup.inline_keyboard[0][0].callback_data).toBe("v2:menu:0");
  });

  it.each([CUSTOMER_TG, STRANGER_TG])("/start for a non-admin id %s: refused, no menu", async (tg) => {
    const body = await (await post(message(tg, "/start"))).json();
    expect(body.text).toContain("не привязан");
    expect(body.reply_markup).toBeUndefined();
  });

  it("group chat: silent, even for ADMIN", async () => {
    const body = await (await post(message(ADMIN_TG, "/start", "group"))).json();
    expect(body).toEqual({ ok: true });
    const cbBody = await (await post(press(ADMIN_TG, "v2:orders:0", "supergroup"))).json();
    expect(cbBody.method).toBe("answerCallbackQuery");
    expect(cbBody.text).toBeUndefined();
  });

  it.each([CUSTOMER_TG, STRANGER_TG])("panel button for non-admin %s: access denied alert, no data", async (tg) => {
    const body = await (await post(press(tg, "v2:orders:0"))).json();
    expect(body).toMatchObject({ method: "answerCallbackQuery", callback_query_id: "cq1", text: "Нет доступа", show_alert: true });
  });

  it("unknown/stale button: short notice, no screen", async () => {
    const body = await (await post(press(ADMIN_TG, "v2:nope:0"))).json();
    expect(body.method).toBe("answerCallbackQuery");
    expect(body.text).toContain("устарела");
  });

  it.each(SCREENS)("screen %s edits the same message and fits Telegram limits", async (screen) => {
    const body = await (await post(press(ADMIN_TG, cb(screen)))).json();
    expect(body).toMatchObject({ method: "editMessageText", chat_id: ADMIN_TG, message_id: 55 });
    expect(body.text.length).toBeGreaterThan(0);
    expect(body.text.length).toBeLessThanOrEqual(4096);
    for (const b of body.reply_markup.inline_keyboard.flat()) {
      expect(parseCallback(b.callback_data)).not.toBeNull();
      expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
    }
  });

  it("orders screen: shows our order without phone, e-mail, name or address", async () => {
    const all = await prisma.order.count();
    let found = "";
    for (let page = 0; page * 10 < Math.max(all, 1) && !found; page++) {
      const { text } = await renderScreen("orders", page);
      if (text.includes(`№P${suffix}`)) found = text;
    }
    expect(found).toContain("оплачен");
    expect(found).toContain("Москва");
    for (const pii of ["+79990001122", `secret-${suffix}@example.com`, "Secret Person", "Тайная"]) expect(found).not.toContain(pii);
  });

  it("problems screen lists the product without INCI / photo / stock", async () => {
    const problems = await catalogProblems();
    const p = problems.find((x) => x.title === `Panel ${suffix} noinci`);
    expect(p?.issues).toEqual(expect.arrayContaining(["нет состава INCI", "нет фото", "опубликован, но нет в наличии"]));
    expect(problems.find((x) => x.title === `Panel ${suffix} ok`)).toBeUndefined();
  });

  it("every screen and page is READ ONLY: the database is byte-identical afterwards", async () => {
    const before = await dbFingerprint();
    for (const screen of SCREENS) {
      for (const page of [0, 1, 999]) await post(press(ADMIN_TG, cb(screen, page)));
    }
    await post(message(ADMIN_TG, "/start"));
    await post(message(ADMIN_TG, "/help"));
    await post(message(ADMIN_TG, "показать товары без INCI"));
    await post(message(ADMIN_TG, "цена Panel 1"));
    await post(message(ADMIN_TG, "опубликовать Panel"));
    await post(press(ADMIN_TG, "confirm:anything"));
    expect(await dbFingerprint()).toBe(before);
  });


  it("a stale page number is clamped instead of showing an empty list", async () => {
    const body = await (await post(press(ADMIN_TG, "v2:products:999"))).json();
    expect(body.text).toMatch(/\n\d+\. /);
    expect(body.text).not.toContain("Товаров нет");
  });
});
