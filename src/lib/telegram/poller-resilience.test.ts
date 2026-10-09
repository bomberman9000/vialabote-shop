// @vitest-environment node
// Telegram CMS V2 — polling bridge resilience (no DB, fake Bot API + fake app).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SeenUpdates,
  TelegramApiError,
  callApi,
  handleUpdate,
  isSafeToRetry,
  loadConfig,
  pollOnce,
} from "../../../scripts/telegram-poller.mjs";

const TOKEN = "123456789:TEST_TOKEN_not_real_bbbbbbbbbbbbbbbb";
const cfg = loadConfig({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: "s", APP_URL: "http://app.test", TELEGRAM_API_BASE: "http://tg.test" });

const netErr = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: { code } });
const timeoutErr = () => Object.assign(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
const noSleep = async () => {};

type Step = Response | Error | ((init: RequestInit) => Promise<Response>);
/** Bot API fake that plays `steps` in order for every call; records method names. */
function scripted(steps: Step[]) {
  const calls: string[] = [];
  const impl = async (url: string, init: RequestInit) => {
    calls.push(url.split("/").pop()!);
    const step = steps.shift() ?? Response.json({ ok: true, result: true });
    if (step instanceof Error) throw step;
    if (typeof step === "function") return step(init);
    return step;
  };
  return { impl, calls };
}
const ok = (result: unknown = true) => Response.json({ ok: true, result });

describe("retry policy — no duplicate answers", () => {
  it.each([
    ["getUpdates", netErr("ECONNRESET"), true],
    ["editMessageText", timeoutErr(), true],
    ["answerCallbackQuery", netErr("ECONNRESET"), true],
    ["sendMessage", netErr("UND_ERR_CONNECT_TIMEOUT"), true], // TLS/connect never finished
    ["sendMessage", netErr("ENOTFOUND"), true],
    ["sendMessage", netErr("ECONNRESET"), false], // may have been delivered
    ["sendMessage", timeoutErr(), false], // ambiguous: Telegram may have sent it
    ["sendMessage", new TelegramApiError("sendMessage", 429, "Too Many Requests", 1), true],
    ["sendMessage", new TelegramApiError("sendMessage", 502, "Bad Gateway"), false],
    ["getUpdates", new TelegramApiError("getUpdates", 502, "Bad Gateway"), true],
    ["sendMessage", new TelegramApiError("sendMessage", 400, "Bad Request"), false],
    ["getUpdates", new TelegramApiError("getUpdates", 409, "Conflict"), false],
    ["getUpdates", new DOMException("aborted", "AbortError"), false], // shutdown
  ] as const)("%s after %s -> retry=%s", (method, err, expected) => {
    expect(isSafeToRetry(method, err)).toBe(expected);
  });

  it("getUpdates survives two network failures and returns the updates", async () => {
    const { impl, calls } = scripted([netErr("ECONNRESET"), netErr("UND_ERR_CONNECT_TIMEOUT"), ok([])]);
    await expect(callApi(cfg, "getUpdates", { timeout: 1 }, { fetchImpl: impl, sleepImpl: noSleep })).resolves.toEqual([]);
    expect(calls).toEqual(["getUpdates", "getUpdates", "getUpdates"]);
  });

  it("sendMessage is sent ONCE when the outcome is ambiguous (reset after connect)", async () => {
    const { impl, calls } = scripted([netErr("ECONNRESET")]);
    await expect(callApi(cfg, "sendMessage", { chat_id: 1, text: "x" }, { fetchImpl: impl, sleepImpl: noSleep })).rejects.toThrow();
    expect(calls).toEqual(["sendMessage"]);
  });

  it("429 waits retry_after seconds, then sends", async () => {
    const waits: number[] = [];
    const { impl, calls } = scripted([Response.json({ ok: false, description: "Too Many Requests", parameters: { retry_after: 3 } }, { status: 429 }), ok()]);
    await callApi(cfg, "sendMessage", { chat_id: 1, text: "x" }, { fetchImpl: impl, sleepImpl: async (ms: number) => void waits.push(ms) });
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([3000]);
  });

  it("gives up after MAX attempts", async () => {
    const { impl, calls } = scripted([netErr("ECONNRESET"), netErr("ECONNRESET"), netErr("ECONNRESET"), ok()]);
    await expect(callApi(cfg, "getUpdates", { timeout: 1 }, { fetchImpl: impl, sleepImpl: noSleep })).rejects.toThrow();
    expect(calls).toHaveLength(3);
  });

  it("a hung request is cut by its own timeout instead of blocking the bridge", async () => {
    const hang = (init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)));
    const { impl } = scripted([hang]);
    const t0 = Date.now();
    await expect(callApi(cfg, "sendMessage", { chat_id: 1, text: "x" }, { fetchImpl: impl, timeoutMs: 50, sleepImpl: noSleep })).rejects.toMatchObject({ name: "TimeoutError" });
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe("callbacks", () => {
  const press = { update_id: 5, callback_query: { id: "cq9", from: { id: 7 }, message: { message_id: 3, chat: { id: 7 } }, data: "v2:stats:0" } };

  function fake(appReply: unknown, tg: (method: string) => Response = () => ok()) {
    const calls: { method: string; body: Record<string, unknown> }[] = [];
    const impl = async (url: string, init: RequestInit) => {
      if (url.startsWith("http://app.test/")) return Response.json(appReply);
      const method = url.split("/").pop()!;
      calls.push({ method, body: JSON.parse(String(init.body)) });
      return tg(method);
    };
    return { impl, calls };
  }

  it("after the screen edit, the button is acknowledged (spinner stops)", async () => {
    const { impl, calls } = fake({ method: "editMessageText", chat_id: 7, message_id: 3, text: "stats" });
    const s = await handleUpdate(cfg, press, { fetchImpl: impl });
    expect(calls.map((c) => c.method)).toEqual(["editMessageText", "answerCallbackQuery"]);
    expect(calls[1].body).toEqual({ callback_query_id: "cq9" });
    expect(s.sent).toBe(true);
  });

  it("no second answerCallbackQuery when the app already answered (access denied alert)", async () => {
    const { impl, calls } = fake({ method: "answerCallbackQuery", callback_query_id: "cq9", text: "Нет доступа", show_alert: true });
    await handleUpdate(cfg, press, { fetchImpl: impl });
    expect(calls.map((c) => c.method)).toEqual(["answerCallbackQuery"]);
  });

  it("'message is not modified' (same screen pressed twice) counts as delivered", async () => {
    const { impl } = fake({ method: "editMessageText", chat_id: 7, message_id: 3, text: "stats" }, (m) =>
      m === "editMessageText" ? Response.json({ ok: false, description: "Bad Request: message is not modified" }, { status: 400 }) : ok(),
    );
    const s = await handleUpdate(cfg, press, { fetchImpl: impl });
    expect(s.sent).toBe(true);
    expect(s.error).toBeUndefined();
  });
});

describe("duplicate updates are not processed twice", () => {
  const upd = (id: number) => ({ update_id: id, message: { message_id: id, chat: { id: 1 }, from: { id: 1 }, text: "/start" } });

  function bridge(batches: unknown[][]) {
    let appCalls = 0;
    const sent: number[] = [];
    const impl = async (url: string, init: RequestInit) => {
      if (url.startsWith("http://app.test/")) {
        appCalls++;
        return Response.json({ method: "sendMessage", chat_id: 1, text: "menu" });
      }
      const method = url.split("/").pop()!;
      if (method === "getUpdates") return ok(batches.shift() ?? []);
      sent.push(JSON.parse(String(init.body)).chat_id);
      return ok();
    };
    return { impl, app: () => appCalls, sent };
  }

  it("the same update delivered again (offset not yet confirmed) is skipped", async () => {
    const seen = new SeenUpdates(null);
    const { impl, app, sent } = bridge([[upd(41), upd(42)], [upd(42), upd(43)]]);
    let off = await pollOnce(cfg, 41, () => {}, { fetchImpl: impl, seen });
    off = await pollOnce(cfg, off, () => {}, { fetchImpl: impl, seen });
    expect(off).toBe(44);
    expect(app()).toBe(3);
    expect(sent).toHaveLength(3);
  });

  it("last handled id survives a restart; replayed batch is skipped", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "poller-state-"));
    try {
      const file = path.join(dir, "last-update-id");
      const first = new SeenUpdates(file);
      const a = bridge([[upd(100), upd(101)]]);
      await pollOnce(cfg, 0, () => {}, { fetchImpl: a.impl, seen: first });
      expect(fs.readFileSync(file, "utf8").trim()).toBe("101");

      const restarted = new SeenUpdates(file); // new process
      expect(restarted.resumeOffset()).toBe(102);
      const b = bridge([[upd(100), upd(101), upd(102)]]); // Telegram replays the unconfirmed batch
      const off = await pollOnce(cfg, restarted.resumeOffset(), () => {}, { fetchImpl: b.impl, seen: restarted });
      expect(b.app()).toBe(1); // only 102
      expect(off).toBe(103);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("STATE_DIRECTORY from systemd selects the state file", () => {
    const c = loadConfig({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: "s", STATE_DIRECTORY: "/var/lib/vialabote-telegram-poller" });
    expect(c.stateFile).toBe("/var/lib/vialabote-telegram-poller/last-update-id");
    expect(loadConfig({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: "s" }).stateFile).toBeNull();
  });

  it("unwritable state file: logs once and keeps deduplicating in memory", async () => {
    const logs: string[] = [];
    const seen = new SeenUpdates("/proc/definitely/not/writable/last-update-id", (l: string) => logs.push(l));
    seen.add(5);
    seen.add(6);
    expect(seen.has(5)).toBe(true);
    expect(seen.has(6)).toBe(true);
    expect(logs.filter((l) => l.includes("not writable"))).toHaveLength(1);
  });

  it("memory set is bounded", () => {
    const seen = new SeenUpdates(null);
    for (let i = 0; i < 1500; i++) seen.add(i);
    expect(seen.ids.size).toBeLessThanOrEqual(1000);
    expect(seen.has(0)).toBe(true); // still covered by "last handled" watermark
  });
});
