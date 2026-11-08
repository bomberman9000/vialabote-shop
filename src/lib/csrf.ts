// CSRF-защита cookie-аутентификации (audit-2026-11-07: к.33 — «нет CSRF-защиты для
// cookie-auth операций»).
//
// Сессия живёт в cookie (next-auth.session-token), поэтому браузер сам приложит её к любому
// запросу, в том числе с чужого сайта. Пароль от CSRF не спасает: полномочие — это cookie.
//
// Два слоя:
//   1. double-submit: клиент присылает значение cookie vialabote-csrf в заголовке x-csrf-token.
//      Значение cookie читает только сам сайт (same-origin), чужой сайт его не достанет;
//   2. Origin/Referer: заголовок Origin обязан указывать на наш хост. Это ДОПОЛНИТЕЛЬНЫЙ слой:
//      даже с корректным токеном запрос с чужого Origin не пройдёт.
//
// Токен обязателен только там, где запрос несёт сессионную cookie: без неё запрос и без
// полномочий, CSRF к нему неприменим.

/** Cookie с CSRF-токеном: значение читает JS, поэтому HttpOnly у неё быть не должно. */
export const CSRF_COOKIE_NAME = "vialabote-csrf";
/** Заголовок, в который клиент кладёт значение этой cookie. */
export const CSRF_HEADER_NAME = "x-csrf-token";
/** Имена сессионной cookie next-auth: на https добавляется префикс __Secure-. */
export const SESSION_COOKIE_NAMES = ["next-auth.session-token", "__Secure-next-auth.session-token"];
/** Методы, меняющие состояние. */
export const MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"];
/** Пути вне нашей проверки: у next-auth своя проверка CSRF-токена на /api/auth/*. */
export const CSRF_EXEMPT_PATH_PREFIXES = ["/api/auth/"];

export type CsrfInput = {
  method: string;
  path: string;
  /** Host, к которому пришёл запрос (заголовок Host). */
  host: string;
  origin?: string | null;
  referer?: string | null;
  /** Значение заголовка x-csrf-token. */
  token?: string | null;
  /** Значение cookie vialabote-csrf. */
  cookieToken?: string | null;
  /** В запросе есть сессионная cookie. */
  hasSession?: boolean;
  /** Дополнительные доверенные Origin (например NEXT_PUBLIC_APP_URL). */
  allowedOrigins?: string[];
};

export type CsrfFailure = "missing-token" | "token-mismatch" | "bad-origin";
export type CsrfResult = { ok: true } | { ok: false; reason: CsrfFailure };

export function isMutatingMethod(method: string): boolean {
  return MUTATING_METHODS.includes(method.toUpperCase());
}

export function isExemptPath(path: string): boolean {
  return CSRF_EXEMPT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** Сессионная cookie в запросе? Её наличие = запрос несёт полномочия. */
export function hasSessionCookie(cookies: { get(name: string): { value: string } | undefined }): boolean {
  return SESSION_COOKIE_NAMES.some((name) => Boolean(cookies.get(name)?.value));
}

/** CSRF-токен: 32 случайных байта в hex. */
export function generateCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Сравнение токенов за постоянное время — по времени ответа токен не подбирается. */
export function tokensMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Хост из Origin или Referer. null — значение не разобралось. */
export function urlHost(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Origin допустим, если его хост — наш хост (схему сверяем по хосту: за nginx приложение видит
 * http, а браузер шлёт https) либо Origin в списке доверенных.
 */
export function originAllowed(origin: string | null | undefined, host: string, allowedOrigins: string[] = []): boolean {
  const candidate = urlHost(origin);
  if (!candidate) return false;
  if (candidate === host.toLowerCase()) return true;
  return allowedOrigins.some((allowed) => urlHost(allowed) === candidate);
}

/** Origin запроса: заголовок Origin, иначе origin из Referer. */
export function requestOrigin(origin: string | null | undefined, referer: string | null | undefined): string | null {
  if (origin) return origin;
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/**
 * Решение по CSRF для одного запроса.
 * ok=false — запрос отклоняется (403).
 */
export function evaluateCsrf(input: CsrfInput): CsrfResult {
  // GET/HEAD и прочее безопасное — не ломаем чтение.
  if (!isMutatingMethod(input.method)) return { ok: true };
  // У next-auth своя проверка CSRF-токена на /api/auth/*.
  if (isExemptPath(input.path)) return { ok: true };
  // Без сессионной cookie запрос не имеет полномочий — CSRF к нему неприменим.
  if (!input.hasSession) return { ok: true };

  if (!input.token || !input.cookieToken) return { ok: false, reason: "missing-token" };
  if (!tokensMatch(input.token, input.cookieToken)) return { ok: false, reason: "token-mismatch" };

  const origin = requestOrigin(input.origin, input.referer);
  if (origin && !originAllowed(origin, input.host, input.allowedOrigins)) return { ok: false, reason: "bad-origin" };

  return { ok: true };
}
