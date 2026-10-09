import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

const ORIGINAL_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ORIGINAL_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const SECRET = "test-webhook-secret";

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET, ...headers },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TOKEN;
  if (ORIGINAL_SECRET === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
  else process.env.TELEGRAM_WEBHOOK_SECRET = ORIGINAL_SECRET;
});

describe("POST /api/telegram/webhook — config gate (owner decision + security fix)", () => {
  it("без TELEGRAM_BOT_TOKEN -> 404, не трогает БД, не падает", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const res = await POST(req({ message: { chat: { id: 1 }, from: { id: 1 }, text: "hi" } }));
    expect(res.status).toBe(404);
  });

  it("токен задан, но TELEGRAM_WEBHOOK_SECRET НЕ задан -> 404 (не 'открытый' webhook без секрета)", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token-not-real";
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const res = await POST(req({ message: { chat: { id: 1 }, from: { id: 1 }, text: "hi" } }));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/telegram/webhook — с настроенным токеном и секретом", () => {
  const suffix = Date.now();
  // Реальный Telegram user id — числовая строка (immutable, owner decision).
  const TG_ID = String(900000000 + (suffix % 100000));
  let categoryId: string;
  let adminUserId: string;

  beforeAll(async () => {
    const category = await prisma.category.create({
      data: { name: "TEST-Webhook", slug: `test-webhook-${suffix}` },
    });
    categoryId = category.id;
    const admin = await prisma.user.create({
      data: {
        email: `test-webhook-admin-${suffix}@example.com`,
        passwordHash: "x",
        role: "ADMIN",
        telegramUserId: TG_ID,
      },
    });
    adminUserId = admin.id;
  });

  afterAll(async () => {
    await prisma.pendingConfirmation.deleteMany({ where: { actorTelegramUserId: TG_ID } });
    await prisma.user.delete({ where: { id: adminUserId } });
    await prisma.category.delete({ where: { id: categoryId } });
  });

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token-not-real";
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  });

  it("неверный секрет заголовка -> 403 (запрос отклонён, ничего не выполнено)", async () => {
    const res = await POST(
      req(
        { message: { chat: { id: 1 }, from: { id: Number(TG_ID) }, text: "hi" } },
        { "x-telegram-bot-api-secret-token": "wrong" },
      ),
    );
    expect(res.status).toBe(403);
  });

  it("отсутствующий заголовок секрета -> 403 (не молчаливый пропуск)", async () => {
    const res = await POST(
      new Request("http://localhost/api/telegram/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: { chat: { id: 1 }, from: { id: Number(TG_ID) }, text: "hi" } }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("верный секрет + нераспознанная команда от привязанного admin -> sendMessage с текстом об ошибке", async () => {
    const res = await POST(req({ message: { chat: { id: 42 }, from: { id: Number(TG_ID) }, text: "абракадабра" } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.method).toBe("sendMessage");
    expect(json.chat_id).toBe(42);
    expect(json.text).toMatch(/не распознана/);
  });

  it("некорректный JSON в теле (с верным секретом) -> {ok:true}, не падает", async () => {
    const res = await POST(
      new Request("http://localhost/api/telegram/webhook", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": SECRET },
        body: "not json",
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });
});
