// Ссылка авторизации частного приложения Ozon и подписанный state (docs.ozon.ru/api/applications, «Получить OAuth-токен»).
// state = <время>.<случайное>.<HMAC>: страница /ozon-oauth меняет code на токен только по ссылке, которую выдал
// scripts/ozon/oauth.ts не раньше STATE_TTL_MS назад. Без этого чужой code (другой кабинет Ozon) можно было бы
// подсунуть магазину ссылкой. Хранить state на сервере не нужно: проверка — подпись и срок.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { OzonConfig } from "./ozon";

export const AUTHORIZE_URL = "https://seller.ozon.ru/app/appstore/oauth/authorize";
export const STATE_TTL_MS = 30 * 60_000;

function mac(key: string, ts: string, nonce: string): string {
  return createHmac("sha256", key).update(`ozon-oauth-state|${ts}|${nonce}`).digest("base64url");
}

/** key — боевой client_secret приложения: он есть и у скрипта, и у сайта, и наружу не уходит. */
export function signState(key: string, now = Date.now()): string {
  const ts = now.toString(36);
  const nonce = randomBytes(9).toString("base64url");
  return `${ts}.${nonce}.${mac(key, ts, nonce)}`;
}

export function verifyState(state: string | null | undefined, key: string, now = Date.now()): boolean {
  const parts = state?.split(".");
  if (!parts || parts.length !== 3 || !/^[0-9a-z]{1,12}$/.test(parts[0])) return false;
  const [ts, nonce, sig] = parts;
  const issued = parseInt(ts, 36);
  if (issued > now + 60_000 || now - issued > STATE_TTL_MS) return false;
  const want = Buffer.from(mac(key, ts, nonce));
  const got = Buffer.from(sig);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** scope — идентификаторы через пробел, как в «Системные настройки → Требуемый уровень доступа к API». */
export function authorizeUrl(cfg: OzonConfig, scope: string, now = Date.now()): string {
  if (cfg.env !== "prod") throw new Error("Авторизация по ссылке — только для боевого приложения (в песочнице client_credentials)");
  if (!cfg.app.redirectUri) throw new Error("Нет OZON_APP_REDIRECT_URI (тот же адрес, что в настройках приложения)");
  const q = new URLSearchParams({
    response_type: "code",
    access_type: "offline", // иначе Ozon не вернёт refresh_token
    client_id: cfg.app.clientId,
    redirect_uri: cfg.app.redirectUri,
    ...(scope.trim() ? { scope: scope.trim() } : {}),
    state: signState(cfg.app.clientSecret, now),
  });
  return `${AUTHORIZE_URL}?${q}`;
}
