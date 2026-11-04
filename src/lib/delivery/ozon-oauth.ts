// Ссылка авторизации частного приложения Ozon и одноразовый state (docs.ozon.ru/api/applications, «Получить OAuth-токен»).
// state = <время>.<nonce>.<HMAC>. Страница /ozon-oauth меняет code на токен, только если подпись верна, срок не вышел
// и nonce ещё лежит в OzonOAuthState: его кладёт scripts/ozon/oauth.ts url, а страница удаляет ДО обмена code.
// Поэтому state из журнала nginx или истории браузера повторно не сработает, и подменить токен магазина токеном
// чужого кабинета Ozon нельзя. Подпись отсекает мусор, не трогая БД.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { OzonConfig } from "./ozon";

export const AUTHORIZE_URL = "https://seller.ozon.ru/app/appstore/oauth/authorize";
export const STATE_TTL_MS = 15 * 60_000;

function mac(key: string, ts: string, nonce: string): string {
  return createHmac("sha256", key).update(`ozon-oauth-state|${ts}|${nonce}`).digest("base64url");
}

/** key — боевой client_secret приложения: он есть и у скрипта, и у сайта, и наружу не уходит. */
export function signState(key: string, now = Date.now()): string {
  const ts = now.toString(36);
  const nonce = randomBytes(12).toString("base64url");
  return `${ts}.${nonce}.${mac(key, ts, nonce)}`;
}

/** Подпись и срок. null — state не наш или устарел; иначе nonce для проверки по БД. */
export function verifyState(state: string | null | undefined, key: string, now = Date.now()): string | null {
  const parts = state?.split(".");
  if (!parts || parts.length !== 3 || !/^[0-9a-z]{1,12}$/.test(parts[0]) || !parts[1]) return null;
  const [ts, nonce, sig] = parts;
  const issued = parseInt(ts, 36);
  if (issued > now + 60_000 || now - issued > STATE_TTL_MS) return null;
  const want = Buffer.from(mac(key, ts, nonce));
  const got = Buffer.from(sig);
  return got.length === want.length && timingSafeEqual(got, want) ? nonce : null;
}

/** Новый state для ссылки: nonce сохраняется в БД (заодно чистятся просроченные). */
export async function issueState(db: PrismaClient, key: string, now = Date.now()): Promise<string> {
  await db.ozonOAuthState.deleteMany({ where: { createdAt: { lt: new Date(now - STATE_TTL_MS) } } });
  const state = signState(key, now);
  await db.ozonOAuthState.create({ data: { nonce: state.split(".")[1], createdAt: new Date(now) } });
  return state;
}

/**
 * Погасить state: true ровно один раз для state, выданного issueState и не просроченного.
 * Удаление атомарно — из двух одновременных запросов с одним state пройдёт только один.
 */
export async function consumeState(db: PrismaClient, state: string | null | undefined, key: string, now = Date.now()): Promise<boolean> {
  const nonce = verifyState(state, key, now);
  if (!nonce) return false;
  const r = await db.ozonOAuthState.deleteMany({ where: { nonce, createdAt: { gte: new Date(now - STATE_TTL_MS) } } });
  return r.count === 1;
}

/** scope — идентификаторы через пробел, как в «Системные настройки → Требуемый уровень доступа к API». */
export function authorizeUrl(cfg: OzonConfig, scope: string, state: string): string {
  if (cfg.env !== "prod") throw new Error("Авторизация по ссылке — только для боевого приложения (в песочнице client_credentials)");
  if (!cfg.app.redirectUri) throw new Error("Нет OZON_APP_REDIRECT_URI (тот же адрес, что в настройках приложения)");
  const q = new URLSearchParams({
    response_type: "code",
    access_type: "offline", // иначе Ozon не вернёт refresh_token
    client_id: cfg.app.clientId,
    redirect_uri: cfg.app.redirectUri,
    ...(scope.trim() ? { scope: scope.trim() } : {}),
    state,
  });
  return `${AUTHORIZE_URL}?${q}`;
}
