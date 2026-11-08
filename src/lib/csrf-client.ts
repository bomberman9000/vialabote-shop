// Клиентский помощник для CSRF-токена (audit-2026-11-07: к.33).
//
// Во все запросы, меняющие состояние, клиент кладёт заголовок x-csrf-token со значением
// cookie vialabote-csrf. Значение cookie недоступно чужому сайту (same-origin), поэтому
// подделать такой заголовок с чужой страницы нельзя.
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/csrf";

/** Значение CSRF-куки, если браузер её уже получил. */
export function readCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${CSRF_COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Заголовки запроса с CSRF-токеном. Использовать во всех изменяющих состояние запросах:
 *   fetch(url, { method: "PATCH", headers: withCsrf({ "Content-Type": "application/json" }), ... })
 */
export function withCsrf(headers?: HeadersInit): Headers {
  const out = new Headers(headers);
  const token = readCsrfToken();
  if (token) out.set(CSRF_HEADER_NAME, token);
  return out;
}
