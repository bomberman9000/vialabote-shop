// @vitest-environment node
// Клиент Ozon без сети: fetch замокан, живых вызовов нет (ключ ограничен IP сервера).
import { describe, it, expect, vi } from "vitest";
import {
  amountToKopecks,
  createOzonClient,
  normalizeRuPhone,
  OzonError,
  ozonConfig,
  ozonItem,
  POINT_LIST_TIMEOUT_MS,
  toOzonPhone,
  withEdgeCookies,
  SANDBOX_BASE,
  Pacer,
  parseRetryAfter,
  requiresOAuth,
  summarizeCheckout,
  toOzonMoney,
  type CheckoutSplit,
  type OzonConfig,
} from "./ozon";

const API_KEY = "api-key-SECRET-123";
const TOKEN = "oauth-access-SECRET-456";
const cfg: OzonConfig = {
  env: "prod",
  base: "https://ozon.test",
  oauthBase: "https://xapi.ozon.test",
  sellerClientId: "100001",
  apiKey: API_KEY,
  app: { clientId: "app-id", clientSecret: "app-SECRET" },
  deliverySchema: "FBS",
  rps: 50,
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(headers),
  json: async () => body,
});

function client(fetchMock: ReturnType<typeof vi.fn>, sleeps: number[] = [], overrides: Partial<OzonConfig> = {}) {
  const getAccessToken = vi.fn().mockResolvedValue(TOKEN);
  const c = createOzonClient(
    { ...cfg, ...overrides },
    { fetch: fetchMock as unknown as typeof fetch, sleep: async (ms) => void sleeps.push(ms), getAccessToken },
  );
  return { c, getAccessToken };
}

describe("ozonConfig", () => {
  it("без учётных данных частного приложения доставка выключена — даже при заданном Api-Key", () => {
    expect(ozonConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(ozonConfig({ OZON_CLIENT_ID: "100001", OZON_API_KEY: "k" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(ozonConfig({ OZON_APP_CLIENT_ID: "a" } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
  it("значения по умолчанию: api-seller.ozon.ru, xapi.ozon.ru, FBS, 20 rps; rps не больше 50", () => {
    const c = ozonConfig({ OZON_APP_CLIENT_ID: "a", OZON_APP_CLIENT_SECRET: "s" } as unknown as NodeJS.ProcessEnv)!;
    expect(c).toMatchObject({ base: "https://api-seller.ozon.ru", oauthBase: "https://xapi.ozon.ru", deliverySchema: "FBS", rps: 20 });
    expect(c.apiKey).toBeUndefined();
    expect(ozonConfig({ OZON_APP_CLIENT_ID: "a", OZON_APP_CLIENT_SECRET: "s", OZON_RPS: "500" } as unknown as NodeJS.ProcessEnv)!.rps).toBe(50);
  });
  it("Api-Key без Client-Id не используется", () => {
    const c = ozonConfig({ OZON_APP_CLIENT_ID: "a", OZON_APP_CLIENT_SECRET: "s", OZON_API_KEY: "k" } as unknown as NodeJS.ProcessEnv)!;
    expect(c.apiKey).toBeUndefined();
  });
  it("OZON_ENV=sandbox: хост песочницы для API и токена, свой секрет, без Api-Key и без переопределений адреса", () => {
    const env = {
      OZON_ENV: "sandbox",
      OZON_APP_CLIENT_ID: "a",
      OZON_APP_CLIENT_SECRET: "prod-s",
      OZON_APP_CLIENT_SECRET_SANDBOX: "sb-s",
      OZON_CLIENT_ID: "100001",
      OZON_API_KEY: "k",
      OZON_API_BASE: "https://api-seller.ozon.ru",
      OZON_OAUTH_BASE: "https://xapi.ozon.ru",
    } as unknown as NodeJS.ProcessEnv;
    const c = ozonConfig(env)!;
    expect(c).toMatchObject({ env: "sandbox", base: SANDBOX_BASE, oauthBase: SANDBOX_BASE, app: { clientId: "a", clientSecret: "sb-s" } });
    expect(c.apiKey).toBeUndefined();
    expect(c.sellerClientId).toBeUndefined();
    // без секрета песочницы песочница выключена, боевой секрет туда не уходит
    expect(ozonConfig({ ...env, OZON_APP_CLIENT_SECRET_SANDBOX: "" })).toBeNull();
  });
  it("OZON_ENV пустой или неизвестный — боевой; секрет песочницы боевому не нужен", () => {
    for (const OZON_ENV of [undefined, "", "production", "PROD"]) {
      const c = ozonConfig({ OZON_ENV, OZON_APP_CLIENT_ID: "a", OZON_APP_CLIENT_SECRET: "s" } as unknown as NodeJS.ProcessEnv)!;
      expect(c).toMatchObject({ env: "prod", base: "https://api-seller.ozon.ru", app: { clientSecret: "s" } });
    }
  });
});

describe("авторизация по методу", () => {
  it("методы Ozon Доставки — только OAuth, базовые — Api-Key", () => {
    for (const p of ["/v1/delivery/point/list", "/v2/delivery/checkout", "/v2/order/create", "/v1/order/cancel", "/v1/posting/cancel", "/v1/cancel-reason/list-by-order"]) {
      expect(requiresOAuth(p)).toBe(true);
    }
    for (const p of ["/v4/product/info/stocks", "/v4/posting/fbs/list", "/v3/posting/fbs/get", "/v1/returns/list", "/v1/roles"]) {
      expect(requiresOAuth(p)).toBe(false);
    }
  });

  it("checkout уходит с Bearer-токеном, без Api-Key; остатки — с Client-Id/Api-Key, без токена", async () => {
    const f = vi.fn().mockResolvedValue(json(200, { splits: [] }));
    const { c } = client(f);
    await c.deliveryCheckout({ delivery_schema: "FBS", delivery_type: { pick_up: { map_point_id: 1 } }, items: [{ sku: 1, quantity: 1 }] });
    await c.productStocks(["A-1"]);
    const [url1, init1] = f.mock.calls[0];
    expect(url1).toBe("https://ozon.test/v2/delivery/checkout");
    expect(init1.method).toBe("POST");
    expect(init1.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init1.headers["Api-Key"]).toBeUndefined();
    expect(init1.signal).toBeInstanceOf(AbortSignal);
    const [url2, init2] = f.mock.calls[1];
    expect(url2).toBe("https://ozon.test/v4/product/info/stocks");
    expect(init2.headers).toMatchObject({ "Client-Id": "100001", "Api-Key": API_KEY });
    expect(init2.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init2.body)).toEqual({ filter: { offer_id: ["A-1"], visibility: "ALL" }, limit: 1000 });
  });

  it("без Api-Key базовые методы идут с OAuth-токеном", async () => {
    const f = vi.fn().mockResolvedValue(json(200, { items: [] }));
    const { c } = client(f, [], { sellerClientId: undefined, apiKey: undefined });
    await c.productStocks(["A-1"]);
    expect(f.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("401 по OAuth: токен обновляется принудительно и запрос повторяется один раз", async () => {
    const f = vi.fn().mockResolvedValueOnce(json(401, {})).mockResolvedValueOnce(json(200, { is_possible: true }));
    const { c, getAccessToken } = client(f);
    expect(await c.deliveryCheck("+79990000000")).toEqual({ is_possible: true });
    expect(getAccessToken.mock.calls.map((a) => a[0])).toEqual([false, true]);
  });
});

describe("ошибки не раскрывают ключ, токен и тело ответа", () => {
  it("в message — только метод, путь, HTTP-код и безопасный code", async () => {
    const f = vi.fn().mockResolvedValue(json(403, { code: 7, message: `Api-Key ${API_KEY} is restricted; phone +79991234567` }));
    const { c } = client(f);
    const err = (await c.productStocks(["A"]).catch((e) => e)) as OzonError;
    expect(err).toBeInstanceOf(OzonError);
    expect(err.message).toBe("Ozon: POST /v4/product/info/stocks -> HTTP 403 (7)");
    const dump = JSON.stringify({ m: err.message, s: String(err), e: { ...err } });
    expect(dump).not.toContain(API_KEY);
    expect(dump).not.toContain(TOKEN);
    expect(dump).not.toContain("79991234567");
  });
  it("длинный/небезопасный code отбрасывается", async () => {
    const f = vi.fn().mockResolvedValue(json(400, { code: "phone +7 999 123-45-67 invalid" }));
    const { c } = client(f);
    const err = (await c.deliveryCheck("x").catch((e) => e)) as OzonError;
    expect(err.ozonCode).toBeUndefined();
    expect(err.message).toBe("Ozon: POST /v1/delivery/check -> HTTP 400");
  });
  it("сеть/таймаут -> kind=network, без подробностей", async () => {
    const f = vi.fn().mockRejectedValue(new Error(`connect ECONNREFUSED Bearer ${TOKEN}`));
    const { c } = client(f);
    const err = (await c.deliveryPointList().catch((e) => e)) as OzonError;
    expect(err.kind).toBe("network");
    expect(err.message).not.toContain(TOKEN);
  });
});

describe("429 и Retry-After", () => {
  it("ждёт столько, сколько сказал Ozon, и повторяет", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json(429, {}, { "Retry-After": "2" }))
      .mockResolvedValueOnce(json(200, { points: [] }));
    const sleeps: number[] = [];
    const { c } = client(f, sleeps);
    await c.deliveryPointList();
    expect(f).toHaveBeenCalledTimes(2);
    expect(sleeps).toContain(2000);
  });
  it("без Retry-After — 1, 2, 4 с; после 3 повторов — OzonError 429", async () => {
    const f = vi.fn().mockResolvedValue(json(429, {}));
    const sleeps: number[] = [];
    const { c } = client(f, sleeps);
    const err = (await c.deliveryPointList().catch((e) => e)) as OzonError;
    expect(err.status).toBe(429);
    expect(f).toHaveBeenCalledTimes(4);
    expect(sleeps.filter((s) => s >= 1000)).toEqual([1000, 2000, 4000]);
  });
  it("Retry-After больше 30 с обрезается", async () => {
    const f = vi.fn().mockResolvedValueOnce(json(429, {}, { "Retry-After": "600" })).mockResolvedValueOnce(json(200, {}));
    const sleeps: number[] = [];
    const { c } = client(f, sleeps);
    await c.deliveryPointList();
    expect(Math.max(...sleeps)).toBe(30_000);
  });
  it("parseRetryAfter: секунды, HTTP-дата, мусор", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter("soon")).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });
});

describe("order/create — реальный заказ, повтор только когда запрос точно не выполнен", () => {
  const body: Parameters<ReturnType<typeof createOzonClient>["orderCreate"]>[0] = {
    buyer: { first_name: "А", last_name: "Б", phone: "+79990000001" },
    recipient: { recipient_first_name: "А", recipient_last_name: "Б", recipient_phone: "+79990000001" },
    delivery: { pick_up: { map_point_id: 1 } },
    delivery_schema: "FBS",
    splits: [],
  };
  it("500 не повторяется", async () => {
    const f = vi.fn().mockResolvedValue(json(500, {}));
    const { c } = client(f);
    await expect(c.orderCreate(body)).rejects.toMatchObject({ status: 500 });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("429 повторяется (Ozon запрос не принял)", async () => {
    const f = vi.fn().mockResolvedValueOnce(json(429, {}, { "Retry-After": "1" })).mockResolvedValueOnce(json(200, { order_number: "N1", postings: ["N1-1"] }));
    const { c } = client(f);
    expect(await c.orderCreate(body)).toEqual({ order_number: "N1", postings: ["N1-1"] });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("2xx без JSON у order/create — исход неизвестен (kind=network)", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => { throw new SyntaxError("x"); } });
    const { c } = client(f);
    await expect(c.orderCreate(body)).rejects.toMatchObject({ kind: "network" });
  });
});

describe("темп ≤ rps", () => {
  it("Pacer разносит старты запросов на 1000/rps мс", async () => {
    let t = 0;
    const sleeps: number[] = [];
    const p = new Pacer(20, () => t, async (ms) => {
      sleeps.push(ms);
      t += ms;
    });
    for (let i = 0; i < 5; i++) await p.wait();
    expect(sleeps).toEqual([20, 20, 20, 20]);
  });
  it("клиент на 50 rps: 10 запросов подряд занимают не меньше 180 мс", async () => {
    let t = 0;
    const f = vi.fn().mockResolvedValue(json(200, { points: [] }));
    const c = createOzonClient(cfg, {
      fetch: f as unknown as typeof fetch,
      now: () => t,
      sleep: async (ms) => void (t += ms),
      getAccessToken: async () => TOKEN,
    });
    await Promise.all(Array.from({ length: 10 }, () => c.deliveryPointList()));
    expect(f).toHaveBeenCalledTimes(10);
    expect(t).toBeGreaterThanOrEqual(180);
  });
});

describe("найдено в песочнице Ozon (живые ответы)", () => {
  it("антибот: 307 на тот же хост с cookie -> один повтор с cookie, тот же метод и тело; дальше cookie сразу", async () => {
    const f = vi.fn(async (url: string, init: RequestInit) => {
      const cookie = (init.headers as Record<string, string>).Cookie;
      if (!cookie) return { ...json(307, {}, { location: `${url.split("?")[0]}?__rr=1`, "set-cookie": "__Secure-ETC=abc; path=/; HttpOnly" }), body: null };
      return json(200, { ok: cookie });
    });
    const wrapped = withEdgeCookies(f as unknown as typeof fetch);
    const r1 = await wrapped("https://ozon.test/oauth/token", { method: "POST", body: "x=1", headers: { "Content-Type": "a/b" } });
    expect(await r1.json()).toEqual({ ok: "__Secure-ETC=abc" });
    expect(f.mock.calls.map((c) => [c[0], c[1].method, c[1].body, c[1].redirect])).toEqual([
      ["https://ozon.test/oauth/token", "POST", "x=1", "manual"],
      ["https://ozon.test/oauth/token?__rr=1", "POST", "x=1", "manual"],
    ]);
    await wrapped("https://ozon.test/v1/x", { method: "POST", headers: {} });
    expect(f).toHaveBeenCalledTimes(3); // cookie уже есть — без нового редиректа
  });
  it("антибот: редирект на чужой хост не выполняется; бесконечный — не больше 3 повторов", async () => {
    const away = vi.fn(async () => json(307, {}, { location: "https://evil.test/x" }));
    expect((await withEdgeCookies(away as unknown as typeof fetch)("https://ozon.test/a", {})).status).toBe(307);
    expect(away).toHaveBeenCalledTimes(1);
    const loop = vi.fn(async (url: string) => json(307, {}, { location: url }));
    expect((await withEdgeCookies(loop as unknown as typeof fetch)("https://ozon.test/a", {})).status).toBe(307);
    expect(loop).toHaveBeenCalledTimes(4);
  });
  it("телефон — только цифры (Ozon: ^\\d{10,15}$) в check, checkout и order/create; позиция — sku ИЛИ offer_id", async () => {
    expect(toOzonPhone("+79990000001")).toBe("79990000001");
    expect(ozonItem({ sku: 5, offer_id: "A", quantity: 1 })).toEqual({ sku: 5, quantity: 1 });
    expect(ozonItem({ offer_id: "A", quantity: 1 })).toEqual({ offer_id: "A", quantity: 1 });
    const f = vi.fn().mockResolvedValue(json(200, {}));
    const { c } = client(f);
    await c.deliveryCheck("+79990000001");
    await c.deliveryCheckout({ buyer_phone: "+79990000001", delivery_schema: "FBS", delivery_type: { pick_up: { map_point_id: 1 } }, items: [{ sku: 5, offer_id: "A", quantity: 1 }] });
    await c.orderCreate({
      buyer: { first_name: "А", last_name: "Б", phone: "+79990000001" },
      recipient: { recipient_first_name: "А", recipient_last_name: "Б", recipient_phone: "+79990000001" },
      delivery: { pick_up: { map_point_id: 1 } },
      delivery_schema: "FBS",
      splits: [
        {
          delivery_method: { delivery_method_id: 1, delivery_type: "PVZ", logistic_date_range: { from: "a", to: "b" }, timeslot_id: 1 },
          items: [{ sku: 5, offer_id: "A", quantity: 1, price: toOzonMoney(100) }],
          warehouse_id: 1,
        },
      ],
    });
    const bodies = f.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(bodies[0]).toEqual({ client_phone: "79990000001" });
    expect(bodies[1]).toMatchObject({ buyer_phone: "79990000001", items: [{ sku: 5, quantity: 1 }] });
    expect(bodies[1].items[0].offer_id).toBeUndefined();
    expect(bodies[2].buyer.phone).toBe("79990000001");
    expect(bodies[2].recipient.recipient_phone).toBe("79990000001");
    expect(bodies[2].splits[0].items[0]).toEqual({ sku: 5, quantity: 1, price: toOzonMoney(100) });
  });
  it("список ПВЗ (~7 МБ, 35–40 с) — свой таймаут, остальные — общий", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    const f = vi.fn().mockResolvedValue(json(200, { points: [] }));
    const { c } = client(f);
    await c.deliveryPointList();
    await c.deliveryCheck("79990000001");
    expect(spy.mock.calls.map((a) => a[0])).toEqual([POINT_LIST_TIMEOUT_MS, 15_000]);
    spy.mockRestore();
  });
});

describe("деньги и телефон", () => {
  it("amountToKopecks без float", () => {
    expect(amountToKopecks("123.45")).toBe(12345);
    expect(amountToKopecks("99")).toBe(9900);
    expect(amountToKopecks("0.1")).toBe(10);
    expect(amountToKopecks("10,5")).toBe(1050);
    expect(amountToKopecks("abc")).toBeNull();
    expect(amountToKopecks(undefined)).toBeNull();
  });
  it("toOzonMoney: целые рубли -> nanos 0", () => {
    expect(toOzonMoney(150000)).toEqual({ units: 1500, nanos: 0, currency_code: "RUB" });
    expect(toOzonMoney(12345)).toEqual({ units: 123, nanos: 450_000_000, currency_code: "RUB" });
  });
  it("normalizeRuPhone", () => {
    expect(normalizeRuPhone("8 (999) 123-45-67")).toBe("+79991234567");
    expect(normalizeRuPhone("+7 999 1234567")).toBe("+79991234567");
    expect(normalizeRuPhone("9991234567")).toBe("+79991234567");
    expect(normalizeRuPhone("+7 846 123-45-67")).toBeNull(); // городской
    expect(normalizeRuPhone("+1 202 555 0100")).toBeNull();
  });
});

describe("summarizeCheckout: цена и максимальный срок", () => {
  const split = (over: Record<string, unknown> = {}): CheckoutSplit => ({
    commissions: { total: { amount: "250.00", currency: "RUB" } },
    delivery_method: {
      id: 77,
      delivery_type: "PVZ",
      timeslots: [
        { timeslot_id: 2, client_date_range: { from: "2026-11-03T00:00:00Z", to: "2026-11-05T21:00:00Z" }, logistic_date_range: { from: "2026-11-02T00:00:00Z", to: "2026-11-05T00:00:00Z" } },
        { timeslot_id: 1, client_date_range: { from: "2026-11-01T00:00:00Z", to: "2026-11-03T21:00:00Z" }, logistic_date_range: { from: "2026-10-31T00:00:00Z", to: "2026-11-03T00:00:00Z" } },
      ],
    },
    items: [{ sku: 111, quantity: 2, offer_id: "A" }],
    warehouse_id: 9,
    ...over,
  }) as CheckoutSplit;

  it("берёт таймслот с самым ранним «до»; цена из комиссии", () => {
    const s = summarizeCheckout({ splits: [split()] });
    expect(s).toMatchObject({ available: true, priceKopecks: 25000, maxDate: "2026-11-03T21:00:00Z" });
    if (s.available) expect(s.splits[0]).toMatchObject({ timeslotId: 1, deliveryMethodId: 77, warehouseId: 9, items: [{ sku: 111, quantity: 2 }] });
  });
  it("два отправления: цена — сумма, срок — самый поздний", () => {
    const late = split({
      commissions: { total: { amount: "100.50" } },
      delivery_method: { id: 78, delivery_type: "PVZ", timeslots: [{ timeslot_id: 5, client_date_range: { to: "2026-11-10T21:00:00Z" }, logistic_date_range: { from: "2026-11-08T00:00:00Z", to: "2026-11-10T00:00:00Z" } }] },
    });
    expect(summarizeCheckout({ splits: [split(), late] })).toMatchObject({ available: true, priceKopecks: 35050, maxDate: "2026-11-10T21:00:00Z" });
  });
  it("commissions = null -> вариант недоступен", () => {
    expect(summarizeCheckout({ splits: [split({ commissions: null })] })).toEqual({ available: false, reason: "NO_PRICE" });
  });
  it("причина недоступности Ozon возвращается как есть", () => {
    expect(summarizeCheckout({ splits: [split({ unavailable_reason: "OUT_OF_STOCK" })] })).toEqual({ available: false, reason: "OUT_OF_STOCK" });
    expect(summarizeCheckout({ splits: [split({ unavailable_reason: "UNSPECIFIED" })] }).available).toBe(true);
  });
  it("нет таймслотов / пустой ответ", () => {
    expect(summarizeCheckout({ splits: [split({ delivery_method: { id: 1, delivery_type: "PVZ", timeslots: [] } })] })).toEqual({ available: false, reason: "NO_TIMESLOT" });
    expect(summarizeCheckout({})).toEqual({ available: false, reason: "NO_SPLITS" });
  });
});
