// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/telegram/webhook/route";
import {
  ALLOWED_UPDATES,
  MAX_APP_ATTEMPTS,
  TelegramApiError,
  callApi,
  handleUpdate,
  loadConfig,
  makeLogger,
  pollOnce,
} from "../../../scripts/telegram-poller.mjs";

const TOKEN = "123456789:TEST_TOKEN_not_real_aaaaaaaaaaaaaaaa";
const SECRET = "poller-test-secret";
const cfg = loadConfig({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: SECRET, APP_URL: "http://app.test", TELEGRAM_API_BASE: "http://tg.test" });

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Fake fetch: app.test -> appHandler, tg.test -> tgHandler; records every call. */
function fakeFetch(
  appHandler: (body: Record<string, unknown>, headers: Record<string, string>) => Promise<Response> | Response,
  tgHandler: (method: string, body: Record<string, unknown>) => unknown = () => true,
) {
  const calls: Call[] = [];
  const impl = async (url: string, init: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = JSON.parse(String(init.body ?? "{}"));
    calls.push({ url, headers, body });
    if (url.startsWith("http://app.test/")) return appHandler(body, headers);
    const method = url.split("/").pop()!;
    const result = tgHandler(method, body);
    if (result instanceof Response) return result;
    return Response.json({ ok: true, result });
  };
  return { impl, calls };
}

const msgUpdate = (id: number, from: number, text: string) => ({
  update_id: id,
  message: { message_id: 1, chat: { id: from }, from: { id: from }, text },
});

describe("telegram-poller — config and logging", () => {
  it("token and secret are both required", () => {
    expect(() => loadConfig({ TELEGRAM_BOT_TOKEN: TOKEN })).toThrow();
    expect(() => loadConfig({ TELEGRAM_WEBHOOK_SECRET: SECRET })).toThrow();
  });

  it("logger redacts token and secret", () => {
    const lines: string[] = [];
    makeLogger(cfg, (l: string) => lines.push(l))(`url /bot${TOKEN}/x secret=${SECRET}`);
    expect(lines[0]).not.toContain(TOKEN);
    expect(lines[0]).not.toContain(SECRET);
    expect(lines[0]).toContain("<token>");
  });

  it("409 from the Bot API surfaces as TelegramApiError with status 409", async () => {
    const { impl } = fakeFetch(
      () => new Response(null),
      () => Response.json({ ok: false, description: "Conflict: can't use getUpdates method while webhook is active" }, { status: 409 }),
    );
    const err = await callApi(cfg, "getUpdates", {}, { fetchImpl: impl }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TelegramApiError);
    expect((err as TelegramApiError).status).toBe(409);
  });
});

describe("telegram-poller — bridge to the webhook route", () => {
  it("forwards the update with the secret header and performs the method the app returned", async () => {
    const { impl, calls } = fakeFetch(() =>
      Response.json({ method: "sendMessage", chat_id: 42, text: "Все активные товары содержат состав (INCI)." }),
    );
    const s = await handleUpdate(cfg, msgUpdate(7, 42, "показать товары без INCI"), { fetchImpl: impl });
    expect(calls[0].url).toBe("http://app.test/api/telegram/webhook");
    expect(calls[0].headers["x-telegram-bot-api-secret-token"]).toBe(SECRET);
    expect(calls[0].body.update_id).toBe(7);
    expect(calls[1].url).toBe(`http://tg.test/bot${TOKEN}/sendMessage`);
    expect(calls[1].body).toEqual({ chat_id: 42, text: "Все активные товары содержат состав (INCI)." });
    expect(s).toMatchObject({ update_id: 7, kind: "message", from: 42, app: 200, method: "sendMessage", sent: true, auth: "ok" });
  });

  it("marks an unlinked account as auth=denied", async () => {
    const { impl } = fakeFetch(() =>
      Response.json({ method: "sendMessage", chat_id: 9, text: "Этот Telegram-аккаунт не привязан к администратору Vialabote." }),
    );
    const s = await handleUpdate(cfg, msgUpdate(1, 9, "x"), { fetchImpl: impl });
    expect(s.auth).toBe("denied");
  });

  it("app reply without a method -> nothing is sent", async () => {
    const { impl, calls } = fakeFetch(() => Response.json({ ok: true }));
    const s = await handleUpdate(cfg, { update_id: 3 }, { fetchImpl: impl });
    expect(calls).toHaveLength(1);
    expect(s.sent).toBeNull();
  });
});

describe("telegram-poller — pollOnce ordering and delivery", () => {
  it("asks getUpdates with offset, long-poll timeout and only message/callback_query; returns last id + 1", async () => {
    const seen: number[] = [];
    const { impl, calls } = fakeFetch(
      (body) => {
        seen.push(body.update_id as number);
        return Response.json({ ok: true });
      },
      (method) => (method === "getUpdates" ? [msgUpdate(10, 1, "a"), msgUpdate(11, 1, "b")] : true),
    );
    const next = await pollOnce(cfg, 10, () => {}, { fetchImpl: impl });
    expect(calls[0].body).toEqual({ offset: 10, timeout: 50, allowed_updates: ALLOWED_UPDATES });
    expect(seen).toEqual([10, 11]);
    expect(next).toBe(12);
  });

  it("app failure does not advance the offset; the update is dropped only after MAX_APP_ATTEMPTS", async () => {
    const attempts = new Map<number, number>();
    const { impl } = fakeFetch(
      () => new Response("down", { status: 502 }),
      (method) => (method === "getUpdates" ? [msgUpdate(20, 1, "a"), msgUpdate(21, 1, "b")] : true),
    );
    const logs: string[] = [];
    for (let i = 1; i < MAX_APP_ATTEMPTS; i++) {
      expect(await pollOnce(cfg, 20, (l: string) => logs.push(l), { fetchImpl: impl, attempts })).toBe(20);
    }
    // last attempt: 20 dropped, 21 fails for the first time -> offset stops at 21
    expect(await pollOnce(cfg, 20, (l: string) => logs.push(l), { fetchImpl: impl, attempts })).toBe(21);
    expect(logs.some((l) => l.includes("update 20 DROPPED"))).toBe(true);
  });

  it("a failed Bot API reply is logged and the update is still acknowledged", async () => {
    const { impl } = fakeFetch(
      () => Response.json({ method: "sendMessage", chat_id: 1, text: "x" }),
      (method) =>
        method === "getUpdates"
          ? [msgUpdate(30, 1, "a")]
          : Response.json({ ok: false, description: "Bad Request: chat not found" }, { status: 400 }),
    );
    const logs: string[] = [];
    expect(await pollOnce(cfg, 30, (l: string) => logs.push(l), { fetchImpl: impl })).toBe(31);
    expect(logs[0]).toContain("sent=false");
  });
});

describe("telegram-poller — end to end through the real webhook route and command layer", () => {
  const suffix = Date.now();
  const ADMIN_TG = String(900000000 + (suffix % 99999999));
  const UNLINKED_TG = 100000001;
  let adminId: string;
  const ORIGINAL = { token: process.env.TELEGRAM_BOT_TOKEN, secret: process.env.TELEGRAM_WEBHOOK_SECRET, mut: process.env.TELEGRAM_CMS_MUTATIONS };

  beforeAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    delete process.env.TELEGRAM_CMS_MUTATIONS;
    const admin = await prisma.user.create({
      data: { email: `poller-admin-${suffix}@example.com`, passwordHash: "x", role: "ADMIN", telegramUserId: ADMIN_TG },
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: adminId } });
    for (const [k, v] of [["TELEGRAM_BOT_TOKEN", ORIGINAL.token], ["TELEGRAM_WEBHOOK_SECRET", ORIGINAL.secret], ["TELEGRAM_CMS_MUTATIONS", ORIGINAL.mut]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  afterEach(async () => {
    await prisma.pendingConfirmation.deleteMany({ where: { actorTelegramUserId: ADMIN_TG } });
  });

  const viaRoute = () =>
    fakeFetch((body, headers) =>
      POST(new Request("http://localhost/api/telegram/webhook", { method: "POST", headers, body: JSON.stringify(body) })),
    );

  it("ADMIN (by Telegram user id) gets the read-only answer", async () => {
    const { impl, calls } = viaRoute();
    const s = await handleUpdate(cfg, msgUpdate(1, Number(ADMIN_TG), "показать товары без INCI"), { fetchImpl: impl });
    expect(s).toMatchObject({ app: 200, method: "sendMessage", sent: true, auth: "ok" });
    expect(String(calls[1].body.text)).toContain("INCI");
  });

  it("an unlinked Telegram id is rejected by the app", async () => {
    const { impl, calls } = viaRoute();
    const s = await handleUpdate(cfg, msgUpdate(2, UNLINKED_TG, "показать товары без INCI"), { fetchImpl: impl });
    expect(s.auth).toBe("denied");
    expect(String(calls[1].body.text)).toContain("не привязан");
  });

  it("catalog mutations stay off: no confirmation is created", async () => {
    const { impl, calls } = viaRoute();
    await handleUpdate(cfg, msgUpdate(3, Number(ADMIN_TG), "цена Multi3 1"), { fetchImpl: impl });
    expect(String(calls[1].body.text)).toContain("отключены");
    expect(await prisma.pendingConfirmation.count({ where: { actorTelegramUserId: ADMIN_TG } })).toBe(0);
  });

  it("a wrong secret never reaches the command layer (403, nothing sent)", async () => {
    const bad = loadConfig({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: "wrong", APP_URL: "http://app.test", TELEGRAM_API_BASE: "http://tg.test" });
    const { impl, calls } = viaRoute();
    await expect(handleUpdate(bad, msgUpdate(4, Number(ADMIN_TG), "показать товары без INCI"), { fetchImpl: impl })).rejects.toThrow("403");
    expect(calls).toHaveLength(1);
  });
});
