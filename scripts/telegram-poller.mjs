// Telegram long polling -> existing webhook route (SITE_2 Telegram CMS).
//
// Why: the public edge cannot exchange traffic with Telegram (RCA 2026-10-09), but the
// ZeroHour PRIMARY VM reaches api.telegram.org. Instead of Telegram pushing updates to
// https://shop.vialabote.ru/api/telegram/webhook, this worker pulls them with getUpdates
// and hands each one to the SAME route on 127.0.0.1:3002, with the same secret header.
// Command parsing, authorization by Telegram user id, the confirmation flow and the
// catalog-mutation kill switch all stay in the app — this file only moves bytes.
// The route answers with a Bot API method in its JSON body (sendMessage /
// editMessageText); the worker performs that call.
//
// Env (from /etc/vialabote-shop/app.env via systemd): TELEGRAM_BOT_TOKEN,
// TELEGRAM_WEBHOOK_SECRET. Optional: APP_URL (default http://127.0.0.1:3002),
// TELEGRAM_API_BASE (default https://api.telegram.org), POLL_TIMEOUT_SECONDS (50).
// The token is never logged: every log line passes through redact().
//
// Delivery: an update is acknowledged (offset advanced) only after the app returned
// 2xx, or after MAX_APP_ATTEMPTS failures (logged as dropped) so one poison update
// cannot block the queue.
// Resilience (V2): every request has its own timeout; idempotent Bot API methods
// (getUpdates, editMessageText, answerCallbackQuery, …) are retried on any transient
// error, non-idempotent ones (sendMessage) only when Telegram certainly did not take the
// request (429, or the connection was never established) — never after an ambiguous
// timeout, so an answer is not sent twice. Updates already handled are skipped: a bounded
// in-memory set plus the last handled update_id persisted in $STATE_DIRECTORY (systemd
// StateDirectory=) or POLLER_STATE_FILE, so a restart does not replay the last batch.
// Callback buttons are always acknowledged (answerCallbackQuery) to stop the spinner.
//
// usage: node scripts/telegram-poller.mjs            run until SIGTERM
//        node scripts/telegram-poller.mjs --check    getMe + getWebhookInfo + app route, exit 0/1
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {(url: string, init: any) => Promise<Response>} FetchLike */
/** @typedef {{ signal?: AbortSignal, fetchImpl?: FetchLike }} CallOpts */

export const ALLOWED_UPDATES = ["message", "callback_query"];
export const MAX_APP_ATTEMPTS = 5;
export const API_TIMEOUT_MS = 20_000;
export const APP_TIMEOUT_MS = 30_000;
export const MAX_API_ATTEMPTS = 3;
export const SEEN_LIMIT = 1000;
/** Repeating these cannot duplicate anything visible to the user. */
export const IDEMPOTENT_METHODS = new Set(["getUpdates", "getMe", "getWebhookInfo", "editMessageText", "editMessageReplyMarkup", "answerCallbackQuery"]);
/** undici/Node codes raised before the request could reach Telegram (TLS handshake included). */
const CONNECT_PHASE_CODES = new Set(["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"]);
// App replies that mean "this Telegram id is not an ADMIN" (message and panel button) — for the auth= log field.
const DENIED_PREFIXES = ["Этот Telegram-аккаунт не привязан", "Нет доступа"];

/** @param {Record<string, string | undefined>} [env] */
export function loadConfig(env = process.env) {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const secret = env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!token || !secret) throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET are required");
  return {
    token,
    secret,
    appUrl: (env.APP_URL || "http://127.0.0.1:3002").replace(/\/$/, ""),
    apiBase: (env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/$/, ""),
    pollTimeout: Number(env.POLL_TIMEOUT_SECONDS || 50),
    stateFile: env.POLLER_STATE_FILE || (env.STATE_DIRECTORY ? path.join(env.STATE_DIRECTORY.split(":")[0], "last-update-id") : null),
  };
}

/** @param {{ token: string, secret: string }} cfg @param {(line: string) => void} [write] */
export function makeLogger(cfg, write = (line) => console.log(line)) {
  const redact = (s) => String(s).split(cfg.token).join("<token>").split(cfg.secret).join("<secret>");
  return (msg) => write(redact(msg));
}

export class TelegramApiError extends Error {
  constructor(method, status, description, retryAfter) {
    super(`${method}: HTTP ${status} ${description ?? ""}`.trim());
    this.method = method;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @param {AbortSignal | undefined} signal @param {number} ms */
function withTimeout(signal, ms) {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}

/** Did the error happen before Telegram could have received the request? */
export function isConnectPhaseError(err) {
  const code = err?.cause?.code ?? err?.code;
  return CONNECT_PHASE_CODES.has(code);
}

/**
 * May `method` be sent again after `err` without risking a duplicate for the user?
 * @param {string} method @param {any} err
 */
export function isSafeToRetry(method, err) {
  if (err?.name === "AbortError" && !(err?.cause?.name === "TimeoutError")) return false; // shutdown
  if (err instanceof TelegramApiError) {
    if (err.status === 429) return true; // rate limited: not processed
    if (err.status >= 500) return IDEMPOTENT_METHODS.has(method);
    return false; // 4xx: retrying will not help
  }
  if (IDEMPOTENT_METHODS.has(method)) return true; // network/timeout: repeating is harmless
  return isConnectPhaseError(err); // non-idempotent: only if it certainly never left
}

/** "Bad Request: message is not modified" — the screen already shows exactly this. */
export function isNotModified(err) {
  return err instanceof TelegramApiError && err.status === 400 && /message is not modified/i.test(err.message);
}

/** Single HTTP call to the Bot API with its own timeout. */
async function callApiOnce(cfg, method, params, signal, fetchImpl, timeoutMs) {
  const res = await fetchImpl(`${cfg.apiBase}/bot${cfg.token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal: withTimeout(signal, timeoutMs),
  });
  let body;
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  if (!res.ok || body.ok !== true) throw new TelegramApiError(method, res.status, body.description, body.parameters?.retry_after);
  return body.result;
}

/**
 * Bot API call with timeout and the duplicate-safe retry policy above.
 * @param {any} cfg @param {string} method @param {Record<string, unknown>} [params]
 * @param {CallOpts & { timeoutMs?: number, attempts?: number, onRetry?: (msg: string) => void, sleepImpl?: (ms: number) => Promise<unknown> }} [opts]
 */
export async function callApi(cfg, method, params = {}, { signal, fetchImpl = fetch, timeoutMs, attempts = MAX_API_ATTEMPTS, onRetry, sleepImpl = sleep } = {}) {
  const ms = timeoutMs ?? (method === "getUpdates" ? (Number(params.timeout ?? 0) + 15) * 1000 : API_TIMEOUT_MS);
  for (let n = 1; ; n++) {
    try {
      return await callApiOnce(cfg, method, params, signal, fetchImpl, ms);
    } catch (err) {
      if (n >= attempts || signal?.aborted || !isSafeToRetry(method, err)) throw err;
      const wait = err instanceof TelegramApiError && err.retryAfter ? err.retryAfter * 1000 : 1000 * n;
      onRetry?.(`${method} attempt ${n}/${attempts} failed (${err?.cause?.code ?? err?.name ?? "error"}: ${err.message}); retry in ${wait} ms`);
      await sleepImpl(wait);
    }
  }
}

/** One update -> app route -> Bot API reply. Returns a summary; throws only if the app did not answer 2xx. */
/** @param {any} cfg @param {any} update @param {CallOpts} [opts] */
export async function handleUpdate(cfg, update, { fetchImpl = fetch, log } = {}) {
  const res = await fetchImpl(`${cfg.appUrl}/api/telegram/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": cfg.secret },
    body: JSON.stringify(update),
    signal: AbortSignal.timeout(APP_TIMEOUT_MS),
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`app answered HTTP ${res.status}`);
  let reply = {};
  try {
    reply = await res.json();
  } catch {
    reply = {};
  }
  const from = update.message?.from?.id ?? update.callback_query?.from?.id ?? null;
  const kind = update.message ? "message" : update.callback_query ? "callback_query" : "other";
  /** @type {{ update_id: number, kind: string, from: number | null, app: number, method: string | null, sent: boolean | null, auth: string | null, error?: string }} */
  const summary = { update_id: update.update_id, kind, from, app: res.status, method: reply.method ?? null, sent: null, auth: null };
  if (typeof reply.text === "string") summary.auth = DENIED_PREFIXES.some((p) => reply.text.startsWith(p)) ? "denied" : "ok";
  if (reply.method) {
    const { method, ...params } = reply;
    try {
      await callApi(cfg, method, params, { fetchImpl, onRetry: log });
      summary.sent = true;
    } catch (err) {
      if (isNotModified(err)) summary.sent = true; // same screen pressed again
      else {
        summary.sent = false;
        summary.error = err.message;
      }
    }
  }
  // stop the button spinner (the app may already have answered it itself)
  if (update.callback_query?.id && reply.method !== "answerCallbackQuery") {
    try {
      await callApi(cfg, "answerCallbackQuery", { callback_query_id: update.callback_query.id }, { fetchImpl });
    } catch {
      /* query too old / already answered — harmless */
    }
  }
  return summary;
}

/** One getUpdates round. Returns the next offset. */
/** Handled-update memory: bounded set + last id persisted to a state file (optional). */
export class SeenUpdates {
  /** @param {string | null} file @param {(msg: string) => void} [log] */
  constructor(file, log = () => {}) {
    this.file = file;
    this.log = log;
    this.ids = new Set();
    this.last = -1;
    this.persistOk = Boolean(file);
    if (file) {
      try {
        const v = Number(fs.readFileSync(file, "utf8").trim());
        if (Number.isSafeInteger(v) && v >= 0) this.last = v;
      } catch (err) {
        if (err?.code !== "ENOENT") log(`state file unreadable (${err.code ?? err.message}) — starting without it`);
      }
    }
  }
  /** @param {number} id */
  has(id) {
    return id <= this.last || this.ids.has(id);
  }
  /** @param {number} id */
  add(id) {
    this.ids.add(id);
    if (this.ids.size > SEEN_LIMIT) this.ids.delete(this.ids.values().next().value);
    if (id > this.last) {
      this.last = id;
      if (this.file && this.persistOk) {
        try {
          fs.writeFileSync(`${this.file}.tmp`, `${id}\n`);
          fs.renameSync(`${this.file}.tmp`, this.file);
        } catch (err) {
          this.persistOk = false;
          this.log(`state file not writable (${err.code ?? err.message}) — dedup continues in memory only`);
        }
      }
    }
  }
  /** offset to resume from after a restart (0 = let Telegram decide) */
  resumeOffset() {
    return this.last >= 0 ? this.last + 1 : 0;
  }
}

/** @param {any} cfg @param {number} offset @param {(msg: string) => void} log @param {CallOpts & { attempts?: Map<number, number>, seen?: SeenUpdates }} [opts] */
export async function pollOnce(cfg, offset, log, { signal, fetchImpl = fetch, attempts = new Map(), seen = new SeenUpdates(null) } = {}) {
  const updates = await callApi(
    cfg,
    "getUpdates",
    { offset, timeout: cfg.pollTimeout, allowed_updates: ALLOWED_UPDATES },
    { signal, fetchImpl, onRetry: log },
  );
  let next = offset;
  for (const update of updates) {
    if (seen.has(update.update_id)) {
      log(`update ${update.update_id} already handled — skipped (duplicate delivery)`);
      next = Math.max(next, update.update_id + 1);
      continue;
    }
    try {
      const s = await handleUpdate(cfg, update, { fetchImpl, log });
      log(`update ${s.update_id} ${s.kind} from=${s.from} app=${s.app} method=${s.method} sent=${s.sent} auth=${s.auth}${s.error ? ` error=${s.error}` : ""}`);
      attempts.delete(update.update_id);
      seen.add(update.update_id);
    } catch (err) {
      const n = (attempts.get(update.update_id) ?? 0) + 1;
      attempts.set(update.update_id, n);
      if (n < MAX_APP_ATTEMPTS) {
        log(`update ${update.update_id} app failed (${err.message}), attempt ${n}/${MAX_APP_ATTEMPTS} — will retry`);
        return next; // stop here: keep order, retry this update next round
      }
      log(`update ${update.update_id} DROPPED after ${n} attempts (${err.message})`);
      attempts.delete(update.update_id);
      seen.add(update.update_id);
    }
    next = update.update_id + 1;
  }
  return next;
}

/** @param {any} cfg @param {(msg: string) => void} log @param {CallOpts} [opts] */
export async function check(cfg, log, { fetchImpl = fetch } = {}) {
  const me = await callApi(cfg, "getMe", {}, { fetchImpl });
  const info = await callApi(cfg, "getWebhookInfo", {}, { fetchImpl });
  const res = await fetchImpl(`${cfg.appUrl}/api/telegram/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": cfg.secret },
    body: "{}",
  });
  log(`CHECK bot=@${me.username} webhook_url=${info.url || "<none>"} pending=${info.pending_update_count} app_route=${res.status}`);
  return res.status === 200;
}

async function main() {
  const cfg = loadConfig();
  const log = makeLogger(cfg);
  if (process.argv.includes("--check")) {
    process.exit((await check(cfg, log)) ? 0 : 1);
  }
  const ac = new AbortController();
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => ac.abort());
  const me = await callApi(cfg, "getMe");
  log(`polling started for @${me.username} (timeout ${cfg.pollTimeout}s, updates ${ALLOWED_UPDATES.join(",")})`);
  const seen = new SeenUpdates(cfg.stateFile, log);
  let offset = seen.resumeOffset();
  log(`state: ${cfg.stateFile ? `${cfg.stateFile} (last handled ${seen.last})` : "memory only"}; resume offset ${offset}`);
  const attempts = new Map();
  let backoff = 1;
  while (!ac.signal.aborted) {
    try {
      offset = await pollOnce(cfg, offset, log, { signal: ac.signal, attempts, seen });
      backoff = 1;
    } catch (err) {
      if (ac.signal.aborted) break;
      if (err instanceof TelegramApiError && err.status === 409) {
        // webhook still set, or another getUpdates consumer: never fight over the queue
        log(`CONFLICT ${err.message} — exiting, systemd restarts later`);
        process.exit(3);
      }
      log(`poll error: ${err.message}; retry in ${backoff}s`);
      await new Promise((r) => setTimeout(r, backoff * 1000));
      backoff = Math.min(backoff * 2, 60);
    }
  }
  log("polling stopped");
}

// Main-module check on real paths: systemd starts us as /opt/vialabote-shop/current/scripts/…
// (`current` is a symlink), and Node resolves the main module to releases/<sha>/scripts/…, so
// comparing import.meta.url with argv[1] never matched and the process exited 0 doing nothing.
function isMain() {
  try {
    return fs.realpathSync(process.argv[1] ?? "") === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  main().catch((err) => {
    console.error(String(err?.message ?? err).split(process.env.TELEGRAM_BOT_TOKEN || "\u0000").join("<token>"));
    process.exit(1);
  });
}
