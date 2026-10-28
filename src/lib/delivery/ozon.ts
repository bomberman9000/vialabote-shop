// Ozon Доставка для своего сайта (Seller API, https://docs.ozon.ru/api/seller/, раздел «Ozon Доставка»).
// Только server-to-server: ключи и токены живут в окружении/БД сервера и никогда не уходят в браузер.
// Песочницы нет — v2/order/create создаёт РЕАЛЬНЫЙ заказ.
//
// Авторизация (сверено со swagger.json 27.10.2026):
//  - методы «Ozon Доставки» (delivery/*, order/*, posting/cancel*, cancel-reason/*) принимают ТОЛЬКО
//    OAuth-токен частного приложения: `Authorization: Bearer …`. Api-Key там -> ошибка
//    «token must be issued for seller, not oauth-client»;
//  - базовые методы (остатки, отправления FBS, возвраты, роли) — Client-Id + Api-Key,
//    а без ключа — тот же OAuth-токен (он работает со всеми методами в пределах выданных уровней доступа).
// Лимит Ozon — 50 запросов/с на все методы одного Client ID; превышение -> 429 + Retry-After.

const DEFAULT_BASE = "https://api-seller.ozon.ru";
const DEFAULT_OAUTH_BASE = "https://xapi.ozon.ru";
// Песочница Ozon Доставки (docs.ozon.ru/api/sandbox): изолированная среда, заказы не настоящие.
// Тот же хост для токена (client_credentials) и для методов; client_id общий, client_secret свой.
export const SANDBOX_BASE = "https://api-seller-sandbox.ozon.ru";
const MAX_RPS = 50;
const TIMEOUT_MS = 15_000;
// Все ПВЗ России — ~7 МБ (~99 тыс. точек), с сервера магазина скачивается 35–40 с: общий таймаут его обрывал.
export const POINT_LIST_TIMEOUT_MS = 120_000;
const MAX_429_RETRIES = 3;
const MAX_RETRY_AFTER_MS = 30_000;

export type OzonDeliverySchema = "FBS" | "FBO" | "MIX";

export interface OzonConfig {
  /** prod — боевой Seller API; sandbox — песочница (OZON_ENV=sandbox), витрина её не использует никогда */
  env: "prod" | "sandbox";
  base: string;
  oauthBase: string;
  /** Seller API: Client-Id + Api-Key (необязательно — без них базовые методы идут с OAuth-токеном) */
  sellerClientId?: string;
  apiKey?: string;
  /** Частное приложение (OAuth) — обязательно для методов доставки */
  app: { clientId: string; clientSecret: string; refreshToken?: string; redirectUri?: string };
  deliverySchema: OzonDeliverySchema;
  rps: number;
}

/**
 * null — Ozon Доставка выключена: нет учётных данных частного приложения, сайт работает как раньше.
 * OZON_ENV=sandbox — песочница: секрет OZON_APP_CLIENT_SECRET_SANDBOX, хост api-seller-sandbox.ozon.ru,
 * токен по client_credentials, Api-Key не используется.
 */
export function ozonConfig(env: NodeJS.ProcessEnv = process.env): OzonConfig | null {
  const mode = env.OZON_ENV?.trim().toLowerCase() === "sandbox" ? "sandbox" : "prod";
  const clientId = env.OZON_APP_CLIENT_ID?.trim();
  const clientSecret = (mode === "sandbox" ? env.OZON_APP_CLIENT_SECRET_SANDBOX : env.OZON_APP_CLIENT_SECRET)?.trim();
  if (!clientId || !clientSecret) return null;
  const sellerClientId = mode === "prod" ? env.OZON_CLIENT_ID?.trim() || undefined : undefined;
  const apiKey = mode === "prod" ? env.OZON_API_KEY?.trim() || undefined : undefined;
  const schema = env.OZON_DELIVERY_SCHEMA?.trim().toUpperCase();
  const rps = Number(env.OZON_RPS);
  return {
    env: mode,
    base: mode === "sandbox" ? SANDBOX_BASE : (env.OZON_API_BASE?.trim() || DEFAULT_BASE).replace(/\/+$/, ""),
    oauthBase: mode === "sandbox" ? SANDBOX_BASE : (env.OZON_OAUTH_BASE?.trim() || DEFAULT_OAUTH_BASE).replace(/\/+$/, ""),
    // Ключ без Client-Id (или наоборот) бесполезен — тогда базовые методы тоже через OAuth.
    ...(sellerClientId && apiKey ? { sellerClientId, apiKey } : {}),
    app: {
      clientId,
      clientSecret,
      refreshToken: env.OZON_APP_REFRESH_TOKEN?.trim() || undefined,
      redirectUri: env.OZON_APP_REDIRECT_URI?.trim() || undefined,
    },
    deliverySchema: schema === "FBO" || schema === "MIX" ? schema : "FBS",
    // Квота общая на все процессы одного Client ID (сайт + опрос статусов), поэтому по умолчанию 20.
    rps: Number.isFinite(rps) && rps > 0 ? Math.min(rps, MAX_RPS) : 20,
  };
}

/** Ошибка Ozon. В message — только метод, путь и HTTP-код: ни ключа, ни тела (там бывают данные покупателя). */
export class OzonError extends Error {
  constructor(
    public readonly path: string,
    public readonly status: number,
    /** короткий код из тела ответа (`code`), если он безопасен для журнала; текст ошибки не сохраняется */
    public readonly ozonCode?: string,
    /** 0 = сеть/таймаут: неизвестно, дошёл ли запрос до Ozon */
    public readonly kind: "http" | "network" | "invalid_response" = "http",
  ) {
    super(
      kind === "network"
        ? `Ozon: POST ${path} -> нет ответа (сеть или таймаут)`
        : kind === "invalid_response"
          ? `Ozon: POST ${path} -> неожиданный ответ`
          : `Ozon: POST ${path} -> HTTP ${status}${ozonCode ? ` (${ozonCode})` : ""}`,
    );
    this.name = "OzonError";
  }
}

const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;
function safeCode(body: unknown): string | undefined {
  const code = (body as { code?: unknown } | null)?.code;
  if (typeof code === "number" && Number.isInteger(code)) return String(code);
  if (typeof code === "string" && SAFE_CODE.test(code)) return code;
  return undefined;
}

// ---------------------------------------------------------------- темп запросов

/** Равномерный темп: не чаще одного старта запроса в 1000/rps мс на процесс. */
export class Pacer {
  private next = 0;
  constructor(
    private readonly intervalMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {}
  async wait(): Promise<void> {
    const t = this.now();
    const slot = Math.max(t, this.next);
    this.next = slot + this.intervalMs;
    if (slot > t) await this.sleep(slot - t);
  }
}

function defaultSleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** Retry-After: секунды или HTTP-дата. Нет/мусор -> null. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const s = Number(value.trim());
  if (Number.isFinite(s) && s >= 0) return Math.round(s * 1000);
  const d = Date.parse(value);
  return Number.isNaN(d) ? null : Math.max(0, d - now);
}

// ---------------------------------------------------------------- клиент

/** Пути «Ozon Доставки»: только OAuth. Остальное — Api-Key, если он задан. */
export function requiresOAuth(path: string): boolean {
  return /^\/v\d+\/(delivery|order|cancel-reason)\//.test(path) || /^\/v\d+\/posting\/(cancel|marks)/.test(path);
}

export interface OzonDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** OAuth access token (src/lib/delivery/ozon-token.ts); force=true — сбросить кеш и обновить */
  getAccessToken: (force?: boolean) => Promise<string>;
}

export interface CallOptions {
  /**
   * false — нельзя повторять после неизвестного исхода (order/create: повтор = второй реальный заказ).
   * 429 и 401 повторяются всегда: такой ответ значит, что запрос НЕ выполнен.
   */
  idempotent?: boolean;
  /** таймаут запроса вместе с телом ответа; по умолчанию TIMEOUT_MS */
  timeoutMs?: number;
}

/**
 * Защита на входе Ozon (видна на api-seller-sandbox.ozon.ru): первый запрос получает 307 на тот же адрес
 * с ?__rr=1 и cookie __Secure-ETC, а без cookie редирект бесконечный. Повторяем запрос на тот же хост с cookie —
 * тот же метод и тело (307/308 это допускают), cookie запоминается для следующих запросов. Редирект на другой
 * хост и прочие ответы возвращаются как есть. Значения cookie никуда не пишутся.
 */
export function withEdgeCookies(doFetch: typeof fetch, maxHops = 3): typeof fetch {
  const jar = new Map<string, Map<string, string>>(); // origin -> имя -> значение
  return async (input, init = {}) => {
    let url = new URL(String(input));
    for (let hop = 0; ; hop++) {
      const cookies = jar.get(url.origin);
      const headers = {
        ...((init.headers ?? {}) as Record<string, string>),
        ...(cookies?.size ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
      };
      const res = await doFetch(url.toString(), { ...init, headers, redirect: "manual" });
      if ((res.status !== 307 && res.status !== 308) || hop >= maxHops) return res;
      const loc = res.headers.get("location");
      const next = loc ? new URL(loc, url) : null;
      if (!next || next.origin !== url.origin) return res;
      const h = res.headers as Headers & { getSetCookie?: () => string[] };
      const raw = typeof h.getSetCookie === "function" ? h.getSetCookie() : [h.get("set-cookie")].filter((x): x is string => !!x);
      const bag = cookies ?? new Map<string, string>();
      for (const c of raw) {
        const m = /^\s*([^=;\s]+)=([^;]*)/.exec(c);
        if (m) bag.set(m[1], m[2]);
      }
      jar.set(url.origin, bag);
      await res.body?.cancel().catch(() => {});
      url = next;
    }
  };
}

export type OzonClient = ReturnType<typeof createOzonClient>;

export function createOzonClient(cfg: OzonConfig, deps: OzonDeps) {
  const doFetch = withEdgeCookies(deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a)));
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const pacer = new Pacer(Math.ceil(1000 / cfg.rps), now, sleep);

  async function headers(path: string, forceToken: boolean): Promise<Record<string, string>> {
    const h: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (!requiresOAuth(path) && cfg.sellerClientId && cfg.apiKey) {
      h["Client-Id"] = cfg.sellerClientId;
      h["Api-Key"] = cfg.apiKey;
    } else {
      h.Authorization = `Bearer ${await deps.getAccessToken(forceToken)}`;
    }
    return h;
  }

  async function call<T>(path: string, body: unknown, opts: CallOptions = {}): Promise<T> {
    let retries429 = 0;
    let retried401 = false;
    for (;;) {
      await pacer.wait();
      const usesOAuth = requiresOAuth(path) || !(cfg.sellerClientId && cfg.apiKey);
      let res: Response;
      try {
        res = await doFetch(`${cfg.base}${path}`, {
          method: "POST",
          headers: await headers(path, retried401),
          body: JSON.stringify(body ?? {}),
          signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
        });
      } catch (err) {
        if (err instanceof OzonError) throw err; // ошибка получения токена
        throw new OzonError(path, 0, undefined, "network");
      }
      if (res.status === 429 && retries429 < MAX_429_RETRIES) {
        const wait = parseRetryAfter(res.headers?.get?.("Retry-After") ?? null, now()) ?? 1000 * 2 ** retries429;
        retries429++;
        await sleep(Math.min(wait, MAX_RETRY_AFTER_MS));
        continue;
      }
      if (res.status === 401 && usesOAuth && !retried401) {
        retried401 = true; // токен отозван/истёк раньше срока — один раз обновляем
        continue;
      }
      if (!res.ok) {
        const parsed = await res.json().catch(() => null);
        throw new OzonError(path, res.status, safeCode(parsed));
      }
      try {
        return (await res.json()) as T;
      } catch {
        // Ответ 2xx без JSON: запрос выполнен, но результата нет. Для неидемпотентных — исход неизвестен.
        throw new OzonError(path, res.status, undefined, opts.idempotent === false ? "network" : "invalid_response");
      }
    }
  }

  return {
    call,

    // ------------------------------------------------ точки самовывоза и доставка
    deliveryPointList: () => call<DeliveryPointListResponse>("/v1/delivery/point/list", {}, { timeoutMs: POINT_LIST_TIMEOUT_MS }),
    deliveryPointInfo: (mapPointIds: string[]) =>
      call<DeliveryPointInfoResponse>("/v1/delivery/point/info", { map_point_ids: mapPointIds.slice(0, 100) }),
    deliveryMap: (viewport: Viewport, zoom: number) => call<DeliveryMapResponse>("/v1/delivery/map", { viewport, zoom }),
    deliveryCheck: (clientPhone: string) => call<{ is_possible?: boolean }>("/v1/delivery/check", { client_phone: toOzonPhone(clientPhone) }),
    deliveryCheckout: (req: CheckoutRequest) =>
      call<CheckoutResponse>("/v2/delivery/checkout", {
        ...req,
        ...(req.buyer_phone ? { buyer_phone: toOzonPhone(req.buyer_phone) } : {}),
        items: req.items.map(ozonItem),
      }),

    // ------------------------------------------------ заказ (реальный!)
    orderCreate: (req: OrderCreateRequest) =>
      call<{ order_number?: string; postings?: string[] }>(
        "/v2/order/create",
        {
          ...req,
          buyer: { ...req.buyer, phone: toOzonPhone(req.buyer.phone) },
          recipient: { ...req.recipient, recipient_phone: toOzonPhone(req.recipient.recipient_phone) },
          splits: req.splits.map((s) => ({ ...s, items: s.items.map(ozonItem) })),
        },
        { idempotent: false },
      ),
    orderCancelCheck: (orderNumber: string) => call<OrderCancelCheckResponse>("/v1/order/cancel/check", { order_number: orderNumber }),
    cancelReasonsByOrder: (orderNumber: string) =>
      call<{ reasons?: { id?: number; name?: string }[] }>("/v1/cancel-reason/list-by-order", { order_number: orderNumber }),
    orderCancel: (orderNumber: string, reasonId: number, reasonMessage?: string) =>
      call<{ message?: string }>(
        "/v1/order/cancel",
        { order_number: orderNumber, reason_id: reasonId, ...(reasonMessage ? { reason_message: reasonMessage } : {}) },
        { idempotent: false },
      ),
    orderCancelStatus: (orderNumber: string) =>
      call<{ order_number?: string; posting_number?: string[]; state?: string }>("/v1/order/cancel/status", { order_number: orderNumber }),
    postingCancel: (postingNumber: string, reasonId: number, reasonMessage?: string) =>
      call<{ message?: string }>(
        "/v1/posting/cancel",
        { posting_number: postingNumber, reason_id: reasonId, ...(reasonMessage ? { reason_message: reasonMessage } : {}) },
        { idempotent: false },
      ),
    postingCancelStatus: (postingNumber: string) =>
      call<{ state?: string; order_number?: string }>("/v1/posting/cancel/status", { posting_number: postingNumber }),

    // ------------------------------------------------ базовые методы
    productStocks: (offerIds: string[]) =>
      call<ProductStocksResponse>("/v4/product/info/stocks", { filter: { offer_id: offerIds, visibility: "ALL" }, limit: 1000 }),
    // /v3/posting/fbs/list отключён Ozon с 31.08.2026 — только v4.
    fbsPostingList: (filter: FbsListFilter, cursor?: string) =>
      call<FbsPostingListResponse>("/v4/posting/fbs/list", { filter, limit: 100, ...(cursor ? { cursor } : {}) }),
    fbsPostingGet: (postingNumber: string) => call<{ result?: FbsPosting }>("/v3/posting/fbs/get", { posting_number: postingNumber }),
    returnsList: (postingNumbers: string[], lastId?: number) =>
      call<ReturnsListResponse>("/v1/returns/list", {
        filter: { posting_numbers: postingNumbers.slice(0, 50) },
        limit: 500,
        ...(lastId ? { last_id: lastId } : {}),
      }),
    roles: () => call<{ expires_at?: string; roles?: { name?: string; methods?: string[] }[] }>("/v1/roles", {}),
  };
}

// ---------------------------------------------------------------- типы (только используемые поля)

export interface LatLong {
  lat: number;
  long: number;
}
export interface Viewport {
  left_bottom: LatLong;
  right_top: LatLong;
}
export interface DeliveryPointListResponse {
  points?: { map_point_id?: number | string; coordinate?: LatLong }[];
}
export interface DeliveryPointInfo {
  enabled?: boolean;
  delivery_method?: {
    map_point_id?: number | string;
    name?: string;
    address?: string;
    address_details?: { city?: string; region?: string; street?: string; house?: string };
    coordinates?: LatLong;
    description?: string;
    storage_period?: number;
    delivery_type?: { id?: number; name?: string };
    working_hours?: { date?: string; periods?: { min?: unknown; max?: unknown }[] }[];
  };
}
export interface DeliveryPointInfoResponse {
  points?: DeliveryPointInfo[];
}
export interface DeliveryMapResponse {
  clusters?: { coordinate?: LatLong; map_point_ids?: (number | string)[]; points_count?: number; viewport?: Viewport; is_same_building?: boolean }[];
}

export interface CheckoutItem {
  sku: number;
  offer_id?: string;
  quantity: number;
}
export interface CheckoutRequest {
  buyer_phone?: string;
  delivery_schema: OzonDeliverySchema;
  delivery_type: { pick_up: { map_point_id: number } } | { courier: { coordinates: { latitude: number; longitude: number } } };
  items: CheckoutItem[];
}
export interface DateRange {
  from?: string;
  to?: string;
}
export interface CheckoutSplit {
  commissions?: { total?: { amount?: string; currency?: string } } | null;
  delivery_method?: {
    id?: number;
    name?: string;
    delivery_type?: "UNSPECIFIED" | "POSTAMAT" | "COURIER" | "PVZ";
    timeslots?: { timeslot_id?: number; client_date_range?: DateRange; logistic_date_range?: DateRange }[];
    unavailable_reason?: string;
  };
  delivery_schema?: string;
  items?: { offer_id?: string; quantity?: number; sku?: number }[];
  unavailable_reason?: string;
  warehouse_id?: number;
}
export interface CheckoutResponse {
  splits?: CheckoutSplit[];
}

export interface OzonMoney {
  units: number;
  nanos: number;
  currency_code: string;
}
export interface OrderCreateRequest {
  buyer: { first_name: string; last_name: string; middle_name?: string; phone: string };
  recipient: { recipient_first_name: string; recipient_last_name: string; recipient_middle_name?: string; recipient_phone: string };
  delivery:
    | { pick_up: { map_point_id: number } }
    | {
        courier: {
          city: string;
          country: string;
          house_number: string;
          coordinates: { latitude: number; longitude: number };
          street?: string;
          apartment?: string;
          entrance?: string;
          floor?: string;
          intercom?: string;
          region?: string;
          zip_code?: string;
          comment?: string;
        };
      };
  delivery_schema: OzonDeliverySchema;
  splits: {
    delivery_method: {
      delivery_method_id: number;
      delivery_type: "COURIER" | "PVZ" | "POSTAMAT";
      logistic_date_range: { from: string; to: string };
      timeslot_id: number;
      price?: OzonMoney;
    };
    items: { sku: number; offer_id?: string; quantity: number; price: OzonMoney }[];
    warehouse_id: number;
  }[];
}

export interface OrderCancelCheckResponse {
  cancellable?: boolean;
  order_number?: string;
  postings?: { cancellable?: boolean; posting_number?: string; why_not_cancellable?: string }[];
}
export interface ProductStocksResponse {
  items?: { offer_id?: string; product_id?: number; stocks?: { present?: number; reserved?: number; sku?: number; type?: string }[] }[];
  cursor?: string;
}
export interface FbsListFilter {
  since: string;
  to: string;
  order_numbers?: string[];
  statuses?: string[];
}
export interface FbsPosting {
  posting_number?: string;
  order_number?: string;
  status?: string;
  substatus?: string;
  tracking_number?: string;
  delivering_date?: string;
  shipment_date?: string;
  products?: { sku?: number; offer_id?: string; quantity?: number }[];
}
export interface FbsPostingListResponse {
  postings?: FbsPosting[];
  has_next?: boolean;
  cursor?: string;
}
export interface OzonReturn {
  id?: number;
  type?: string;
  posting_number?: string;
  order_number?: string;
  return_reason_name?: string;
  product?: { sku?: number; offer_id?: string; quantity?: number };
  visual?: { status?: { sys_name?: string; display_name?: string }; change_moment?: string };
}
export interface ReturnsListResponse {
  returns?: OzonReturn[];
  has_next?: boolean;
}

// ---------------------------------------------------------------- деньги и расчёт

/** "123.45" -> 12345 копеек; без float. Мусор -> null. */
export function amountToKopecks(amount: string | number | undefined | null): number | null {
  if (amount === undefined || amount === null) return null;
  const s = String(amount).trim();
  const m = /^(\d+)(?:[.,](\d{1,2})\d*)?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

/**
 * Копейки -> {units, nanos}. Поля названы как google.type.Money (nanos = 10⁻⁹ единицы), хотя в описании
 * Ozon nanos — «часть стоимости в копейках». Не подтверждено: при целых рублях nanos = 0 и разночтения нет.
 */
export function toOzonMoney(kopecks: number): OzonMoney {
  const k = Math.max(0, Math.round(kopecks));
  return { units: Math.floor(k / 100), nanos: (k % 100) * 10_000_000, currency_code: "RUB" };
}

export interface ChosenSplit {
  warehouseId: number;
  deliveryMethodId: number;
  deliveryType: "COURIER" | "PVZ" | "POSTAMAT";
  timeslotId: number;
  logisticDateRange: { from: string; to: string };
  clientDateTo: string;
  priceKopecks: number;
  items: { sku: number; offerId?: string; quantity: number }[];
}

export type QuoteSummary =
  | { available: true; priceKopecks: number; maxDate: string; splits: ChosenSplit[] }
  | { available: false; reason: string };

/**
 * Итог /v2/delivery/checkout для покупателя: цена = сумма комиссий всех отправлений,
 * максимальный срок = самая поздняя граница интервала получения среди отправлений
 * (в каждом берём таймслот с самым ранним «до»). Недоступно хоть одно отправление — недоступно всё.
 */
export function summarizeCheckout(res: CheckoutResponse): QuoteSummary {
  const splits = res.splits ?? [];
  if (splits.length === 0) return { available: false, reason: "NO_SPLITS" };
  const chosen: ChosenSplit[] = [];
  for (const s of splits) {
    const reason = s.unavailable_reason && s.unavailable_reason !== "UNSPECIFIED" ? s.unavailable_reason : undefined;
    const methodReason =
      s.delivery_method?.unavailable_reason && s.delivery_method.unavailable_reason !== "UNSPECIFIED"
        ? s.delivery_method.unavailable_reason
        : undefined;
    if (reason || methodReason) return { available: false, reason: (reason ?? methodReason)! };
    const price = amountToKopecks(s.commissions?.total?.amount);
    if (!s.commissions || price === null) return { available: false, reason: "NO_PRICE" };
    const m = s.delivery_method;
    const type = m?.delivery_type;
    if (!m?.id || !type || type === "UNSPECIFIED" || !s.warehouse_id) return { available: false, reason: "NO_METHOD" };
    const slots = (m.timeslots ?? []).filter(
      (t) => t.timeslot_id && t.client_date_range?.to && t.logistic_date_range?.from && t.logistic_date_range?.to,
    );
    if (slots.length === 0) return { available: false, reason: "NO_TIMESLOT" };
    const best = slots.reduce((a, b) => (Date.parse(b.client_date_range!.to!) < Date.parse(a.client_date_range!.to!) ? b : a));
    chosen.push({
      warehouseId: s.warehouse_id,
      deliveryMethodId: m.id,
      deliveryType: type,
      timeslotId: best.timeslot_id!,
      logisticDateRange: { from: best.logistic_date_range!.from!, to: best.logistic_date_range!.to! },
      clientDateTo: best.client_date_range!.to!,
      priceKopecks: price,
      items: (s.items ?? [])
        .filter((i) => i.sku && i.quantity)
        .map((i) => ({ sku: Number(i.sku), offerId: i.offer_id, quantity: Number(i.quantity) })),
    });
  }
  const maxDate = chosen.reduce((a, c) => (Date.parse(c.clientDateTo) > Date.parse(a) ? c.clientDateTo : a), chosen[0].clientDateTo);
  return { available: true, priceKopecks: chosen.reduce((s, c) => s + c.priceKopecks, 0), maxDate, splits: chosen };
}

/**
 * Телефон в запросе к Ozon — только цифры: Ozon проверяет ^\d{10,15}$ (ответ песочницы на «+7…»: HTTP 400).
 * В заказе сайта телефон хранится как +7XXXXXXXXXX (normalizeRuPhone), переводится здесь, в клиенте.
 */
export function toOzonPhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Позиция в запросе к Ozon: sku ИЛИ offer_id. Оба сразу Ozon отклоняет: HTTP 400 «either sku or offer_id
 * should be specified for each item» (проверено в песочнице). sku точнее — он, если есть.
 */
export function ozonItem<T extends { sku?: number; offer_id?: string }>(item: T): Omit<T, "sku" | "offer_id"> & ({ sku: number } | { offer_id: string }) {
  const { sku, offer_id, ...rest } = item;
  return sku ? { ...rest, sku } : { ...rest, offer_id: offer_id! };
}

/** Телефон покупателя -> +7XXXXXXXXXX (Ozon доставляет только по РФ). Иначе null. */
export function normalizeRuPhone(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && (d[0] === "7" || d[0] === "8") ? d.slice(1) : d.length === 10 ? d : null;
  return ten && ten[0] === "9" ? `+7${ten}` : null;
}
