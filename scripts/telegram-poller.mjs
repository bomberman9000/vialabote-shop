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
// cannot block the queue. A failed Bot API reply is logged, not retried.
//
// usage: node scripts/telegram-poller.mjs            run until SIGTERM
//        node scripts/telegram-poller.mjs --check    getMe + getWebhookInfo + app route, exit 0/1
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/** @typedef {(url: string, init: any) => Promise<Response>} FetchLike */
/** @typedef {{ signal?: AbortSignal, fetchImpl?: FetchLike }} CallOpts */

export const ALLOWED_UPDATES = ["message", "callback_query"];
export const MAX_APP_ATTEMPTS = 5;
const UNLINKED_PREFIX = "Этот Telegram-аккаунт не привязан";

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
  };
}

/** @param {{ token: string, secret: string }} cfg @param {(line: string) => void} [write] */
export function makeLogger(cfg, write = (line) => console.log(line)) {
  const redact = (s) => String(s).split(cfg.token).join("<token>").split(cfg.secret).join("<secret>");
  return (msg) => write(redact(msg));
}

export class TelegramApiError extends Error {
  constructor(method, status, description) {
    super(`${method}: HTTP ${status} ${description ?? ""}`.trim());
    this.method = method;
    this.status = status;
  }
}

/** @param {any} cfg @param {string} method @param {Record<string, unknown>} [params] @param {CallOpts} [opts] */
export async function callApi(cfg, method, params = {}, { signal, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${cfg.apiBase}/bot${cfg.token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal,
  });
  let body;
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  if (!res.ok || body.ok !== true) throw new TelegramApiError(method, res.status, body.description);
  return body.result;
}

/** One update -> app route -> Bot API reply. Returns a summary; throws only if the app did not answer 2xx. */
/** @param {any} cfg @param {any} update @param {CallOpts} [opts] */
export async function handleUpdate(cfg, update, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${cfg.appUrl}/api/telegram/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": cfg.secret },
    body: JSON.stringify(update),
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
  const summary = { update_id: update.update_id, kind, from, app: res.status, method: reply.method ?? null, sent: null, auth: null };
  if (typeof reply.text === "string") summary.auth = reply.text.startsWith(UNLINKED_PREFIX) ? "denied" : "ok";
  if (reply.method) {
    const { method, ...params } = reply;
    try {
      await callApi(cfg, method, params, { fetchImpl });
      summary.sent = true;
    } catch (err) {
      summary.sent = false;
      summary.error = err.message;
    }
  }
  return summary;
}

/** One getUpdates round. Returns the next offset. */
/** @param {any} cfg @param {number} offset @param {(msg: string) => void} log @param {CallOpts & { attempts?: Map<number, number> }} [opts] */
export async function pollOnce(cfg, offset, log, { signal, fetchImpl = fetch, attempts = new Map() } = {}) {
  const updates = await callApi(
    cfg,
    "getUpdates",
    { offset, timeout: cfg.pollTimeout, allowed_updates: ALLOWED_UPDATES },
    { signal, fetchImpl },
  );
  let next = offset;
  for (const update of updates) {
    try {
      const s = await handleUpdate(cfg, update, { fetchImpl });
      log(`update ${s.update_id} ${s.kind} from=${s.from} app=${s.app} method=${s.method} sent=${s.sent} auth=${s.auth}${s.error ? ` error=${s.error}` : ""}`);
      attempts.delete(update.update_id);
    } catch (err) {
      const n = (attempts.get(update.update_id) ?? 0) + 1;
      attempts.set(update.update_id, n);
      if (n < MAX_APP_ATTEMPTS) {
        log(`update ${update.update_id} app failed (${err.message}), attempt ${n}/${MAX_APP_ATTEMPTS} — will retry`);
        return next; // stop here: keep order, retry this update next round
      }
      log(`update ${update.update_id} DROPPED after ${n} attempts (${err.message})`);
      attempts.delete(update.update_id);
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
  let offset = 0;
  const attempts = new Map();
  let backoff = 1;
  while (!ac.signal.aborted) {
    try {
      offset = await pollOnce(cfg, offset, log, { signal: ac.signal, attempts });
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
