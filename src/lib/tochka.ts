// Интернет-эквайринг Точка Банка — платёжные ссылки.
// Документация: https://developers.tochka.com/docs/tochka-api/opisanie-metodov/platyozhnye-ssylki
//
// Сайт НИКОГДА не верит покупателю или телу вебхука на слово: статус оплаты всегда берётся
// из API банка (getPaymentOperation). Вебхук — только сигнал «проверь операцию», и его подпись
// (JWT RS256 публичным ключом банка) проверяется до любого действия.
//
// TLS: API подписан сертификатом НУЦ Минцифры — процессу магазина нужен корень
// «Russian Trusted Root CA» через NODE_EXTRA_CA_CERTS (см. docs/tochka-payments.md).
import { createPublicKey, verify, type JsonWebKey } from "crypto";

export const TOCHKA_API_DEFAULT = "https://enter.tochka.com/uapi";
export const TOCHKA_PUBLIC_KEY_URL = "https://enter.tochka.com/doc/openapi/static/keys/public";

export interface TochkaConfig {
  token: string;
  customerCode: string; // код компании (customerType "Business"), НЕ customer_code из JWT
  merchantId?: string; // нужен, только если торговых точек несколько
  apiBase: string;
}

type Env = Record<string, string | undefined>;

export function getTochkaConfig(env: Env = process.env): TochkaConfig | null {
  const token = env.TOCHKA_API_TOKEN?.trim();
  const customerCode = env.TOCHKA_CUSTOMER_CODE?.trim();
  if (!token || !customerCode) return null;
  return {
    token,
    customerCode,
    merchantId: env.TOCHKA_MERCHANT_ID?.trim() || undefined,
    apiBase: (env.TOCHKA_API_BASE?.trim() || TOCHKA_API_DEFAULT).replace(/\/$/, ""),
  };
}

export class TochkaError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TochkaError";
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Ответы банка не должны унести токен в логи. */
function scrub(text: string, token: string): string {
  return token ? text.split(token).join("<token>") : text;
}

async function call<T>(cfg: TochkaConfig, path: string, init: RequestInit, fetchImpl: FetchLike): Promise<T> {
  const res = await fetchImpl(cfg.apiBase + path, {
    ...init,
    // Next.js 14 кэширует серверные GET-запросы fetch (Data Cache) — статус оплаты навсегда
    // застыл бы на первом ответе банка. Ни один запрос к банку кэшировать нельзя.
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new TochkaError(res.status, `Точка: HTTP ${res.status}: ${scrub(text, cfg.token).slice(0, 300)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new TochkaError(res.status, "Точка: ответ не JSON");
  }
}

/** Копейки -> рубли числом с двумя знаками (формат банка: 1234.00 как number). */
export function rublesFromKopecks(kopecks: number): number {
  if (!Number.isInteger(kopecks) || kopecks <= 0) throw new TochkaError(0, `Некорректная сумма: ${kopecks}`);
  return Math.round(kopecks) / 100;
}

export function kopecksFromRubles(rubles: number): number {
  return Math.round(rubles * 100);
}

export interface CreateLinkInput {
  amountKopecks: number;
  purpose: string;
  successUrl: string;
  failUrl: string;
}

export interface PaymentLink {
  operationId: string;
  paymentLink: string;
}

export async function createPaymentLink(cfg: TochkaConfig, input: CreateLinkInput, fetchImpl: FetchLike = fetch): Promise<PaymentLink> {
  const json = await call<{ Data?: { operationId?: string; paymentLink?: string } }>(
    cfg,
    "/acquiring/v1.0/payments",
    {
      method: "POST",
      body: JSON.stringify({
        Data: {
          customerCode: cfg.customerCode,
          amount: rublesFromKopecks(input.amountKopecks),
          purpose: input.purpose.slice(0, 210),
          paymentMode: ["card", "sbp"],
          successRedirectUrl: input.successUrl,
          failRedirectUrl: input.failUrl,
          ...(cfg.merchantId ? { merchantId: cfg.merchantId } : {}),
        },
      }),
    },
    fetchImpl,
  );
  const operationId = json.Data?.operationId;
  const paymentLink = json.Data?.paymentLink;
  if (!operationId || !paymentLink) throw new TochkaError(200, "Точка не вернула operationId/paymentLink");
  return { operationId, paymentLink };
}

/** Статусы операции по платёжной ссылке (как в API банка). */
export type TochkaStatus =
  | "CREATED"
  | "APPROVED"
  | "AUTHORIZED"
  | "ON-REFUND"
  | "REFUNDED"
  | "REFUNDED_PARTIALLY"
  | "EXPIRED"
  | "WAIT_FULL_PAYMENT"
  | (string & {});

export interface PaymentOperation {
  operationId: string;
  status: TochkaStatus;
  amountKopecks: number;
}

export async function getPaymentOperation(cfg: TochkaConfig, operationId: string, fetchImpl: FetchLike = fetch): Promise<PaymentOperation> {
  if (!/^[0-9a-fA-F-]{16,64}$/.test(operationId)) throw new TochkaError(0, "Некорректный operationId");
  const json = await call<{ Data?: { Operation?: Array<{ operationId?: string; status?: string; amount?: number }> } }>(
    cfg,
    `/acquiring/v1.0/payments/${encodeURIComponent(operationId)}`,
    { method: "GET" },
    fetchImpl,
  );
  const op = json.Data?.Operation?.find((o) => o.operationId === operationId);
  if (!op?.status || typeof op.amount !== "number") throw new TochkaError(200, "Точка: операция не найдена в ответе");
  return { operationId, status: op.status, amountKopecks: kopecksFromRubles(op.amount) };
}

// ---------------------------------------------------------------- вебхук

function b64urlJson(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

/**
 * Проверяет подпись JWT из тела вебхука (RS256, публичный ключ банка в формате JWK)
 * и возвращает payload. Неверная подпись / алгоритм / формат -> null.
 */
export function verifyWebhookJwt(jwt: string, publicJwk: JsonWebKey): Record<string, unknown> | null {
  const parts = jwt.trim().split(".");
  if (parts.length !== 3) return null;
  try {
    const header = b64urlJson(parts[0]);
    if (header.alg !== "RS256") return null;
    const key = createPublicKey({ key: publicJwk, format: "jwk" });
    const ok = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], "base64url"));
    return ok ? b64urlJson(parts[1]) : null;
  } catch {
    return null;
  }
}

let cachedKey: { jwk: JsonWebKey; at: number } | null = null;

/** Публичный ключ банка для вебхуков; кэш на 6 часов. */
export async function getTochkaPublicKey(fetchImpl: FetchLike = fetch, now = Date.now()): Promise<JsonWebKey> {
  if (cachedKey && now - cachedKey.at < 6 * 3600_000) return cachedKey.jwk;
  const res = await fetchImpl(TOCHKA_PUBLIC_KEY_URL, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new TochkaError(res.status, "Точка: публичный ключ недоступен");
  const jwk = (await res.json()) as JsonWebKey;
  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) throw new TochkaError(200, "Точка: неожиданный формат ключа");
  cachedKey = { jwk, at: now };
  return jwk;
}
