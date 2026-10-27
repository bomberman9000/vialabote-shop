// @vitest-environment node
// Поведение без токенов и списка владельцев — только фикстуры, без БД и без реальных значений.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { POST } from "@/app/api/telegram/webhook/route";
import { isTelegramMutationsEnabled } from "./config";
import { isAdminListConfigured, decideWriteAccess } from "./access";
import { loadConfig } from "../../../scripts/telegram-poller.mjs";

const KEYS = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_ADMIN_IDS", "TELEGRAM_CMS_MUTATIONS"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
});
afterAll(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const webhook = () =>
  POST(new Request("http://localhost/api/telegram/webhook", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "x" }, body: "{}" }));

describe("webhook route without credentials", () => {
  it.each([
    ["no token, no secret", {}],
    ["token only", { TELEGRAM_BOT_TOKEN: "fixture-token" }],
    ["secret only", { TELEGRAM_WEBHOOK_SECRET: "fixture-secret" }],
    ["blank values", { TELEGRAM_BOT_TOKEN: "  ", TELEGRAM_WEBHOOK_SECRET: " " }],
  ])("%s -> 404, no crash", async (_name, env) => {
    Object.assign(process.env, env);
    const res = await webhook();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

describe("poller loadConfig at startup", () => {
  it.each([{}, { TELEGRAM_BOT_TOKEN: "fixture-token" }, { TELEGRAM_WEBHOOK_SECRET: "fixture-secret" }, { TELEGRAM_BOT_TOKEN: " ", TELEGRAM_WEBHOOK_SECRET: " " }])(
    "missing credentials %j -> clear error naming both variables",
    (env) => {
      expect(() => loadConfig(env)).toThrow("TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET are required");
    },
  );
  it("defaults for the optional variables", () => {
    const cfg = loadConfig({ TELEGRAM_BOT_TOKEN: "fixture-token", TELEGRAM_WEBHOOK_SECRET: "fixture-secret" });
    expect(cfg).toMatchObject({ appUrl: "http://127.0.0.1:3002", apiBase: "https://api.telegram.org", pollTimeout: 50, stateFile: null });
  });
});

describe("empty TELEGRAM_ADMIN_IDS", () => {
  it.each([undefined, "", "  ", ",", "not-a-number"])("%j -> writes off, no exception", (ids) => {
    if (ids !== undefined) process.env.TELEGRAM_ADMIN_IDS = ids;
    process.env.TELEGRAM_CMS_MUTATIONS = "enabled"; // старая переменная ничего не включает
    expect(() => isTelegramMutationsEnabled()).not.toThrow();
    expect(isTelegramMutationsEnabled()).toBe(false);
    expect(isAdminListConfigured()).toBe(false);
    expect(decideWriteAccess("123", true)).toBe(false);
  });
});
