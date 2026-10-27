// OAuth-токен частного приложения Ozon (https://docs.ozon.ru/api/applications/, POST xapi.ozon.ru/oauth/token).
// access_token живёт expires_in секунд, refresh_token меняется при каждом обновлении — поэтому оба в БД
// (модель OzonOAuthToken), а обновление идёт под блокировкой строки: два процесса (сайт и опрос статусов)
// не потратят один refresh_token дважды. Ни токены, ни client_secret не попадают в ошибки и журналы.
import type { PrismaClient } from "@prisma/client";
import { OzonError, type OzonConfig } from "./ozon";

const DEFAULT_ROW_ID = "seller";
const EARLY_REFRESH_MS = 60_000;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string[] | string;
}

export interface TokenDeps {
  prisma: PrismaClient;
  fetch?: typeof fetch;
  now?: () => number;
  /** строка OzonOAuthToken; по умолчанию "seller" (другое значение — только тесты) */
  rowId?: string;
}

async function requestToken(cfg: OzonConfig, body: Record<string, string>, doFetch: typeof fetch): Promise<TokenResponse> {
  const fields = { client_id: cfg.app.clientId, client_secret: cfg.app.clientSecret, ...body };
  // Песочница: статья Ozon показывает x-www-form-urlencoded (стандарт OAuth), swagger — JSON. Шлём форму,
  // при отказе в формате (400/415) — один раз JSON. Боевой xapi.ozon.ru — JSON (docs.ozon.ru/api/applications).
  const send = (form: boolean) =>
    doFetch(`${cfg.oauthBase}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json", Accept: "application/json" },
      body: form ? new URLSearchParams(fields).toString() : JSON.stringify(fields),
      signal: AbortSignal.timeout(15_000),
    });
  let res: Response;
  try {
    res = await send(cfg.env === "sandbox");
    if (cfg.env === "sandbox" && (res.status === 400 || res.status === 415)) res = await send(false);
  } catch {
    throw new OzonError("/oauth/token", 0, undefined, "network");
  }
  const json = (await res.json().catch(() => null)) as (TokenResponse & { message?: string }) | null;
  if (!res.ok || !json?.access_token) {
    // Единственная безопасная подробность — признак «refresh_token недействителен»: нужна повторная авторизация.
    const invalid = json?.message === "invalid_refresh_token" ? "invalid_refresh_token" : undefined;
    throw new OzonError("/oauth/token", res.status, invalid, res.ok ? "invalid_response" : "http");
  }
  return json;
}

function scopeText(scope: TokenResponse["scope"]): string | null {
  if (Array.isArray(scope)) return scope.join(" ");
  return typeof scope === "string" ? scope : null;
}

/** Хранилище токена: кеш в памяти процесса + строка в БД. */
export function createTokenStore(cfg: OzonConfig, deps: TokenDeps) {
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = deps.now ?? Date.now;
  // Токен песочницы хранится отдельно от боевого: смена OZON_ENV не подсунет один вместо другого.
  const ROW_ID = deps.rowId ?? (cfg.env === "sandbox" ? "sandbox" : DEFAULT_ROW_ID);
  let cached: { token: string; expiresAt: number } | null = null;
  let inflight: Promise<string> | null = null;

  const fresh = (expiresAt: number | null | undefined) => typeof expiresAt === "number" && expiresAt - EARLY_REFRESH_MS > now();

  async function refreshLocked(force: boolean): Promise<string> {
    if (cfg.env === "sandbox") return sandboxLocked(force);
    return deps.prisma.$transaction(
      async (tx) => {
        if (cfg.app.refreshToken) {
          // Стартовое значение из env — только если строки ещё нет (дальше живёт ротированное из БД).
          await tx.$executeRaw`INSERT INTO "OzonOAuthToken" ("id", "refreshToken", "updatedAt") VALUES (${ROW_ID}, ${cfg.app.refreshToken}, NOW()) ON CONFLICT ("id") DO NOTHING`;
        }
        const rows = await tx.$queryRaw<{ accessToken: string | null; expiresAt: Date | null; refreshToken: string }[]>`
          SELECT "accessToken", "expiresAt", "refreshToken" FROM "OzonOAuthToken" WHERE "id" = ${ROW_ID} FOR UPDATE`;
        const row = rows[0];
        if (!row) throw new OzonError("/oauth/token", 401, "not_authorized");
        // Пока ждали блокировку, другой процесс мог уже обновить токен.
        if (!force && row.accessToken && fresh(row.expiresAt?.getTime())) {
          cached = { token: row.accessToken, expiresAt: row.expiresAt!.getTime() };
          return row.accessToken;
        }
        const t = await requestToken(cfg, { grant_type: "refresh_token", refresh_token: row.refreshToken }, doFetch);
        const expiresAt = new Date(now() + Math.max(60, Number(t.expires_in) || 3600) * 1000);
        await tx.ozonOAuthToken.update({
          where: { id: ROW_ID },
          data: {
            accessToken: t.access_token!,
            expiresAt,
            refreshToken: t.refresh_token || row.refreshToken,
            scope: scopeText(t.scope),
          },
        });
        cached = { token: t.access_token!, expiresAt: expiresAt.getTime() };
        return t.access_token!;
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
  }

  /** Песочница: client_credentials, без refresh_token — новый токен по истечении. Та же блокировка строки. */
  async function sandboxLocked(force: boolean): Promise<string> {
    return deps.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`INSERT INTO "OzonOAuthToken" ("id", "refreshToken", "updatedAt") VALUES (${ROW_ID}, '', NOW()) ON CONFLICT ("id") DO NOTHING`;
        const rows = await tx.$queryRaw<{ accessToken: string | null; expiresAt: Date | null }[]>`
          SELECT "accessToken", "expiresAt" FROM "OzonOAuthToken" WHERE "id" = ${ROW_ID} FOR UPDATE`;
        const row = rows[0];
        if (!force && row?.accessToken && fresh(row.expiresAt?.getTime())) {
          cached = { token: row.accessToken, expiresAt: row.expiresAt!.getTime() };
          return row.accessToken;
        }
        const t = await requestToken(cfg, { grant_type: "client_credentials" }, doFetch);
        const expiresAt = new Date(now() + Math.max(60, Number(t.expires_in) || 3600) * 1000);
        await tx.ozonOAuthToken.update({ where: { id: ROW_ID }, data: { accessToken: t.access_token!, expiresAt, scope: scopeText(t.scope) } });
        cached = { token: t.access_token!, expiresAt: expiresAt.getTime() };
        return t.access_token!;
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
  }

  return {
    /** Действующий access_token; force=true — Ozon ответил 401, обновить, даже если срок не вышел. */
    async getAccessToken(force = false): Promise<string> {
      if (!force && cached && fresh(cached.expiresAt)) return cached.token;
      if (force) cached = null;
      // Параллельные запросы одного процесса ждут одно обновление.
      inflight ??= refreshLocked(force).finally(() => {
        inflight = null;
      });
      return inflight;
    },

    /** Первичная авторизация: код из redirect_uri -> токены в БД (scripts/ozon/oauth.ts). */
    async exchangeCode(code: string): Promise<{ expiresIn: number; scope: string | null }> {
      if (!cfg.app.redirectUri) throw new Error("Не задан OZON_APP_REDIRECT_URI");
      const t = await requestToken(cfg, { grant_type: "authorization_code", code, redirect_uri: cfg.app.redirectUri }, doFetch);
      if (!t.refresh_token) throw new Error("Ozon не вернул refresh_token: в ссылке авторизации нужен access_type=offline");
      const expiresIn = Math.max(60, Number(t.expires_in) || 3600);
      const data = {
        accessToken: t.access_token!,
        expiresAt: new Date(now() + expiresIn * 1000),
        refreshToken: t.refresh_token,
        scope: scopeText(t.scope),
      };
      await deps.prisma.ozonOAuthToken.upsert({ where: { id: ROW_ID }, create: { id: ROW_ID, ...data }, update: data });
      cached = null;
      return { expiresIn, scope: data.scope };
    },
  };
}
