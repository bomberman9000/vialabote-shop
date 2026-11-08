// @vitest-environment node
// CSRF-защита cookie-аутентификации (audit-2026-11-07: к.33 — «нет CSRF-защиты для cookie-auth
// операций»).
//
// Проверяем решение (evaluateCsrf) и сам middleware: чужой Origin без токена -> 403,
// валидный токен -> ок, чтение (GET) не ломается.
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  evaluateCsrf,
  generateCsrfToken,
  tokensMatch,
} from "@/lib/csrf";
import { middleware } from "@/middleware";

const HOST = "shop.vialabote.ru";
const TOKEN = "a".repeat(64);

const base = {
  path: "/api/admin/products",
  host: HOST,
  token: TOKEN,
  cookieToken: TOKEN,
  hasSession: true,
};

describe("evaluateCsrf: правила CSRF (audit-2026-11-07: к.33)", () => {
  it("чтение (GET/HEAD) не ломается", () => {
    expect(evaluateCsrf({ ...base, method: "GET", token: null, cookieToken: null })).toEqual({ ok: true });
    expect(evaluateCsrf({ ...base, method: "HEAD", token: null, cookieToken: null })).toEqual({ ok: true });
  });

  it("запрос без сессионной cookie не проверяется: полномочий у него нет", () => {
    const res = evaluateCsrf({ ...base, method: "POST", hasSession: false, token: null, cookieToken: null });
    expect(res).toEqual({ ok: true });
  });

  it("изменяющий запрос с сессией, но без CSRF-токена — отклонён", () => {
    expect(evaluateCsrf({ ...base, method: "POST", token: null })).toEqual({ ok: false, reason: "missing-token" });
    expect(evaluateCsrf({ ...base, method: "POST", cookieToken: null })).toEqual({ ok: false, reason: "missing-token" });
  });

  it("токен не совпадает с cookie — отклонён", () => {
    expect(evaluateCsrf({ ...base, method: "POST", token: "b".repeat(64) })).toEqual({
      ok: false,
      reason: "token-mismatch",
    });
  });

  it("валидный токен и наш Origin — пропущен", () => {
    expect(evaluateCsrf({ ...base, method: "POST", origin: `https://${HOST}` })).toEqual({ ok: true });
  });

  it("валидный токен, но чужой Origin — отклонён (дополнительный слой)", () => {
    expect(evaluateCsrf({ ...base, method: "POST", origin: "https://evil.example" })).toEqual({
      ok: false,
      reason: "bad-origin",
    });
  });

  it("валидный токен и чужой Referer — отклонён", () => {
    expect(evaluateCsrf({ ...base, method: "POST", referer: "https://evil.example/x" })).toEqual({
      ok: false,
      reason: "bad-origin",
    });
  });

  it("валидный токен и наш Referer — пропущен", () => {
    expect(evaluateCsrf({ ...base, method: "POST", referer: `https://${HOST}/admin/products` })).toEqual({ ok: true });
  });

  it("/api/auth/* — вне нашей проверки: у next-auth свой CSRF-токен", () => {
    expect(
      evaluateCsrf({ ...base, method: "POST", path: "/api/auth/callback/credentials", token: null, cookieToken: null }),
    ).toEqual({ ok: true });
  });

  it("Origin сверяется по хосту: за nginx схема в приложении http, а браузер шлёт https", () => {
    expect(evaluateCsrf({ ...base, method: "POST", origin: `http://${HOST}` })).toEqual({ ok: true });
  });

  it("токен: 32 случайных байта в hex, значения не повторяются", () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(tokensMatch(a, a)).toBe(true);
    expect(tokensMatch(a, b)).toBe(false);
    expect(tokensMatch(a, "short")).toBe(false);
    expect(tokensMatch(null, null)).toBe(false);
  });
});

/** Запрос с сессионной cookie (и, по желанию, CSRF-кукой). */
function req(options: { method?: string; path?: string; origin?: string; referer?: string; token?: string | null; session?: boolean; csrfCookie?: string | null } = {}) {
  const headers = new Headers();
  if (options.origin) headers.set("origin", options.origin);
  if (options.referer) headers.set("referer", options.referer);
  if (options.token) headers.set(CSRF_HEADER_NAME, options.token);
  const cookies: string[] = [];
  if (options.session !== false) cookies.push("__Secure-next-auth.session-token=session-value");
  if (options.csrfCookie) cookies.push(`${CSRF_COOKIE_NAME}=${options.csrfCookie}`);
  if (cookies.length) headers.set("cookie", cookies.join("; "));
  return new NextRequest(`https://${HOST}${options.path ?? "/api/admin/products"}`, {
    method: options.method ?? "POST",
    headers,
  });
}

describe("middleware: CSRF на живых запросах (audit-2026-11-07: к.33)", () => {
  it("чужой Origin без CSRF-токена -> 403", () => {
    const res = middleware(req({ origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("наш Origin, но токен не совпал с cookie -> 403", () => {
    const res = middleware(req({ origin: `https://${HOST}`, csrfCookie: TOKEN, token: "b".repeat(64) }));
    expect(res.status).toBe(403);
  });

  it("валидный токен -> запрос проходит", () => {
    const res = middleware(req({ origin: `https://${HOST}`, csrfCookie: TOKEN, token: TOKEN }));
    expect(res.status).toBe(200);
  });

  it("GET не ломается и выдаёт CSRF-куку, если её ещё нет", () => {
    const res = middleware(req({ method: "GET", path: "/catalog" }));
    expect(res.status).toBe(200);
    const cookie = res.cookies.get(CSRF_COOKIE_NAME);
    expect(cookie?.value).toMatch(/^[0-9a-f]{64}$/);
    // cookie читает JS — HttpOnly у неё быть не должно
    expect(cookie?.httpOnly).toBe(false);
  });

  it("публичный checkout без сессии не ломается (гость оформляет заказ)", () => {
    const res = middleware(req({ path: "/api/orders", session: false }));
    expect(res.status).toBe(200);
  });

  it("вебхуки банка и Ozon не ломаются: сессии в них нет", () => {
    expect(middleware(req({ path: "/api/payment/tochka/webhook", session: false })).status).toBe(200);
    expect(middleware(req({ path: "/api/delivery/ozon/webhook", session: false })).status).toBe(200);
  });
});
