// @vitest-environment node
// Публичные маршруты /api/delivery/ozon/*: выключатель, кеш ПВЗ и карты, проверка, расчёт, заготовка вебхука.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { clearOzonCache, resetRequestLimits } from "@/lib/delivery/ozon-service";
import { checkoutReply, fakeFetch, stocksReply } from "@/lib/delivery/__fixtures__/fake-ozon";

vi.mock("@/lib/delivery/ozon-token", () => ({
  createTokenStore: () => ({ getAccessToken: async () => "test-token", exchangeCode: async () => ({ expiresIn: 1, scope: null }) }),
}));

const status = await import("./route");
const points = await import("./points/route");
const info = await import("./points/info/route");
const search = await import("./points/search/route");
const map = await import("./map/route");
const quote = await import("./quote/route");
const webhook = await import("./webhook/route");

const on = () => {
  vi.stubEnv("OZON_APP_CLIENT_ID", "app");
  vi.stubEnv("OZON_APP_CLIENT_SECRET", "secret");
  vi.stubEnv("OZON_CHECKOUT_ENABLED", "1");
};
const get = (url: string, ip = "10.0.0.1") => new Request(`http://localhost${url}`, { headers: { "x-forwarded-for": ip } });
const post = (url: string, body: unknown, ip = "10.0.0.1") =>
  new Request(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": ip } });

const POINTS = {
  points: [
    { map_point_id: 1, coordinate: { lat: 53.2001, long: 50.1001 } }, // Самара, центр
    { map_point_id: 2, coordinate: { lat: 55.7558, long: 37.6173 } }, // Москва
    { map_point_id: 3, coordinate: { lat: 53.21, long: 50.12 } }, // Самара, рядом
  ],
};
const card = (id: number) => ({ enabled: true, delivery_method: { map_point_id: id, name: `ПВЗ ${id}`, address: `адрес ${id}`, address_details: { city: "Самара" }, storage_period: 14 } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  clearOzonCache();
  resetRequestLimits();
});

describe("выключатель", () => {
  it("без OZON_APP_* — enabled:false и 503 на всех методах, в Ozon не ходим", async () => {
    const fake = fakeFetch({});
    vi.stubGlobal("fetch", fake.fetch);
    expect(await (await status.GET()).json()).toEqual({ enabled: false, map: null });
    expect((await points.GET(get("/api/delivery/ozon/points?lat=53.2&long=50.1"))).status).toBe(503);
    expect((await quote.POST(post("/api/delivery/ozon/quote", {}))).status).toBe(503);
    expect((await webhook.POST(post("/api/delivery/ozon/webhook", {}))).status).toBe(503);
    expect(fake.fetch).not.toHaveBeenCalled();
  });
  it("с OZON_APP_* и OZON_CHECKOUT_ENABLED=1 — enabled:true", async () => {
    on();
    expect(await (await status.GET()).json()).toEqual({ enabled: true, map: null });
  });
  it("карта — только свой сервер плиток из MAP_TILE_URL; без Ozon карты нет", async () => {
    on();
    vi.stubEnv("MAP_TILE_URL", "/maps/current/styles/gruzpotok/{z}/{x}/{y}.png");
    expect(await (await status.GET()).json()).toEqual({
      enabled: true,
      map: { url: "/maps/current/styles/gruzpotok/{z}/{x}/{y}.png", attribution: "© OpenMapTiles © OpenStreetMap contributors", maxZoom: 18 },
    });
    vi.stubEnv("OZON_CHECKOUT_ENABLED", "");
    expect(await (await status.GET()).json()).toEqual({ enabled: false, map: null });
  });
  it("ключи есть, но витрина не включена — покупатель Ozon не видит; песочница на витрину не попадает никогда", async () => {
    const fake = fakeFetch({});
    vi.stubGlobal("fetch", fake.fetch);
    on();
    vi.stubEnv("OZON_CHECKOUT_ENABLED", "");
    expect(await (await status.GET()).json()).toEqual({ enabled: false, map: null });
    expect((await points.GET(get("/api/delivery/ozon/points?lat=53.2&long=50.1"))).status).toBe(503);

    on();
    vi.stubEnv("OZON_ENV", "sandbox");
    vi.stubEnv("OZON_APP_CLIENT_SECRET_SANDBOX", "sb-secret");
    expect(await (await status.GET()).json()).toEqual({ enabled: false, map: null });
    expect((await quote.POST(post("/api/delivery/ozon/quote", {}))).status).toBe(503);
    expect((await webhook.POST(post("/api/delivery/ozon/webhook", {}))).status).toBe(503);
    expect(fake.fetch).not.toHaveBeenCalled();
  });
});

describe("ПВЗ и карта", () => {
  it("ближайшие к точке, по возрастанию расстояния; полный список берётся у Ozon один раз (кеш)", async () => {
    on();
    const fake = fakeFetch({ "/v1/delivery/point/list": () => ({ body: POINTS }) });
    vi.stubGlobal("fetch", fake.fetch);
    const r1 = await (await points.GET(get("/api/delivery/ozon/points?lat=53.2&long=50.1&limit=2"))).json();
    expect(r1.points.map((p: { id: string }) => p.id)).toEqual(["1", "3"]);
    expect(r1.points[0].distanceKm).toBeLessThan(1);
    const r2 = await (await points.GET(get("/api/delivery/ozon/points?minLat=55&minLong=37&maxLat=56&maxLong=38"))).json();
    expect(r2.points.map((p: { id: string }) => p.id)).toEqual(["2"]);
    expect(fake.count("/v1/delivery/point/list")).toBe(1);
    expect(fake.calls[0].headers.Authorization).toBe("Bearer test-token");
  });

  it("без координат — 400", async () => {
    on();
    expect((await points.GET(get("/api/delivery/ozon/points"))).status).toBe(400);
  });

  it("карточки ПВЗ кешируются по одной: второй запрос докачивает только недостающие", async () => {
    on();
    const fake = fakeFetch({ "/v1/delivery/point/info": (b) => ({ body: { points: b.map_point_ids.map((id: string) => card(Number(id))) } }) });
    vi.stubGlobal("fetch", fake.fetch);
    const a = await (await info.GET(get("/api/delivery/ozon/points/info?ids=1,3"))).json();
    expect(a.points).toEqual([
      expect.objectContaining({ id: "1", name: "ПВЗ 1", city: "Самара", storageDays: 14 }),
      expect.objectContaining({ id: "3" }),
    ]);
    await info.GET(get("/api/delivery/ozon/points/info?ids=3,7"));
    expect(fake.bodies("/v1/delivery/point/info")).toEqual([{ map_point_ids: ["1", "3"] }, { map_point_ids: ["7"] }]);
    expect((await info.GET(get("/api/delivery/ozon/points/info?ids=abc"))).status).toBe(400);
  });

  it("поиск по улице: адреса пунктов у центра города; дом — целиком; дальние и выключенные не попадают; кеш", async () => {
    on();
    const STREET = {
      points: [
        ...POINTS.points,
        { map_point_id: 4, coordinate: { lat: 53.24, long: 50.2 } }, // Самара, ~8 км
        { map_point_id: 5, coordinate: { lat: 53.2, long: 50.11 } }, // Самара, пункт выключен
      ],
    };
    const addr: Record<number, string> = {
      1: "Россия, Самарская Область, Самара, улица Свободы, 2",
      3: "Россия, Самарская Область, Самара, улица Ленина, 5",
      4: "Россия, Самарская Область, Самара, улица Свободы, 20",
      5: "Россия, Самарская Область, Самара, улица Свободы, 3",
    };
    const fake = fakeFetch({
      "/v1/delivery/point/list": () => ({ body: STREET }),
      "/v1/delivery/point/info": (b) => ({
        body: {
          points: b.map_point_ids.map((id: string) => {
            const c = card(Number(id));
            return { ...c, enabled: id !== "5", delivery_method: { ...c.delivery_method, address: addr[Number(id)] } };
          }),
        },
      }),
    });
    vi.stubGlobal("fetch", fake.fetch);
    const find = async (q: string) =>
      (await (await search.GET(get(`/api/delivery/ozon/points/search?lat=53.2&long=50.1&q=${encodeURIComponent(q)}`))).json()).points;

    const street = await find("Свободы");
    expect(street.map((p: { id: string }) => p.id)).toEqual(["1", "4"]);
    expect(street[0]).toEqual(expect.objectContaining({ address: addr[1], storageDays: 14 }));
    expect(street[0].distanceKm).toBeLessThan(street[1].distanceKm);
    expect((await find("ул. Свободы, д. 2")).map((p: { id: string }) => p.id)).toEqual(["1"]);
    expect(await find("Гагарина")).toEqual([]);
    // Москва дальше радиуса — её карточку у Ozon не спрашиваем; повторные поиски — из кеша.
    expect(fake.bodies("/v1/delivery/point/info")).toEqual([{ map_point_ids: ["1", "5", "3", "4"] }]);

    expect((await search.GET(get("/api/delivery/ozon/points/search?lat=53.2&long=50.1&q=ул."))).status).toBe(400);
    expect((await search.GET(get("/api/delivery/ozon/points/search?lat=53.2&long=50.1"))).status).toBe(400);
  });

  it("карта: кластеры с кешем по округлённой области", async () => {
    on();
    const fake = fakeFetch({ "/v1/delivery/map": () => ({ body: { clusters: [{ coordinate: { lat: 53.2, long: 50.1 }, map_point_ids: [1, 3], points_count: 2 }] } }) });
    vi.stubGlobal("fetch", fake.fetch);
    const v = (d: number) => ({ viewport: { left_bottom: { lat: 53.1 + d, long: 50.0 }, right_top: { lat: 53.3, long: 50.2 } }, zoom: 12 });
    const r = await (await map.POST(post("/api/delivery/ozon/map", v(0)))).json();
    expect(r.clusters).toEqual([expect.objectContaining({ count: 2, pointIds: ["1", "3"] })]);
    await map.POST(post("/api/delivery/ozon/map", v(0.0001))); // та же область после округления
    expect(fake.count("/v1/delivery/map")).toBe(1);
    expect((await map.POST(post("/api/delivery/ozon/map", { zoom: 3 }))).status).toBe(400);
  });

  it("сбой Ozon -> 502 без подробностей", async () => {
    on();
    vi.stubGlobal("fetch", fakeFetch({ "/v1/delivery/point/list": () => ({ status: 500, body: { message: "internal" } }) }).fetch);
    const res = await points.GET(get("/api/delivery/ozon/points?lat=1&long=1"));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("internal");
  });
});

describe("проверка, расчёт, ограничение частоты", () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  let categoryId = "";
  let productId = "";
  beforeAll(async () => {
    categoryId = (await prisma.category.create({ data: { name: `RT ${suffix}`, slug: `rt-${suffix}` } })).id;
    productId = (
      await prisma.product.create({
        data: { title: `RT ${suffix}`, slug: `rt-${suffix}`, description: "", price: 99000, imageUrl: "/x.png", stock: 3, status: "published", isActive: true, categoryId, ozonSku: "4242", ozonOfferId: "RT-1" },
      })
    ).id;
  });
  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
  });

  const quoteWorld = () =>
    fakeFetch({
      "/v4/product/info/stocks": () => stocksReply([{ offer_id: "RT-1", present: 3 }]),
      "/v2/delivery/checkout": () => checkoutReply([{ sku: 4242, quantity: 1 }], { amount: "189.90", to: "2026-11-09T20:59:59Z" }),
    });
  const quoteBody = () => ({ items: [{ productId, quantity: 1 }], destination: { type: "PVZ", mapPointId: "1" } });

  it("quote: цена в копейках и максимальный срок; телефон в Ozon не уходит; кривой запрос — 400", async () => {
    on();
    const fake = quoteWorld();
    vi.stubGlobal("fetch", fake.fetch);
    const res = await quote.POST(post("/api/delivery/ozon/quote", { ...quoteBody(), phone: "+79990001122" }));
    expect(await res.json()).toEqual({ available: true, deliveryType: "PVZ", priceKopecks: 18990, maxDate: "2026-11-09T20:59:59Z", shipments: 1 });
    expect(fake.bodies("/v2/delivery/checkout")[0].buyer_phone).toBeUndefined();
    expect((await quote.POST(post("/api/delivery/ozon/quote", { items: [], destination: { type: "PVZ", mapPointId: "x" } }))).status).toBe(400);
  });

  it("публичной проверки номера нет (оракул аккаунтов Ozon) — только при оформлении заказа", () => {
    expect(existsSync(path.join(__dirname, "check", "route.ts"))).toBe(false);
  });

  it("с одного адреса не больше 30 расчётов в минуту; подмена левого X-Forwarded-For не помогает", async () => {
    on();
    const fake = quoteWorld();
    vi.stubGlobal("fetch", fake.fetch);
    const codes: number[] = [];
    for (let i = 0; i < 32; i++) {
      const spoofed = new Request("http://localhost/api/delivery/ozon/quote", {
        method: "POST",
        body: JSON.stringify(quoteBody()),
        headers: { "x-forwarded-for": `203.0.113.${i}, 10.9.9.9` }, // левое — от клиента, правое — от нашего прокси
      });
      codes.push((await quote.POST(spoofed)).status);
    }
    expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
    expect(codes.slice(30)).toEqual([429, 429]);
    expect((await quote.POST(post("/api/delivery/ozon/quote", quoteBody(), "10.9.9.10"))).status).toBe(200);
  });

  it("адрес клиента: X-Real-IP не читается (наши прокси его не ставят), XFF — с учётом TRUSTED_PROXY_HOPS", async () => {
    const { clientKey } = await import("@/lib/delivery/ozon-service");
    const r = (h: Record<string, string>) => new Request("http://x", { headers: h });
    expect(clientKey(r({ "x-real-ip": "198.51.100.7", "x-forwarded-for": "1.1.1.1" }))).toBe("1.1.1.1");
    expect(clientKey(r({ "x-forwarded-for": "6.6.6.6, 1.1.1.1, 2.2.2.2" }))).toBe("2.2.2.2");
    // edge + VM дописывают XFF -> 2 доверенных прокси: клиент — второй справа, подделка слева игнорируется
    expect(clientKey(r({ "x-forwarded-for": "6.6.6.6, 1.1.1.1, 2.2.2.2" }), { TRUSTED_PROXY_HOPS: "2" } as unknown as NodeJS.ProcessEnv)).toBe("1.1.1.1");
    expect(clientKey(r({ "x-forwarded-for": "2.2.2.2" }), { TRUSTED_PROXY_HOPS: "2" } as unknown as NodeJS.ProcessEnv)).toBe("2.2.2.2");
    expect(clientKey(r({ "x-real-ip": "198.51.100.7" }))).toBe("local");
  });

  it("отклонённые запросы одного клиента не тратят общий потолок — остальные не страдают", async () => {
    const { allowRequest } = await import("@/lib/delivery/ozon-service");
    const from = (ip: string) => new Request("http://x", { headers: { "x-forwarded-for": ip } });
    let passedA = 0;
    for (let i = 0; i < 100; i++) if (allowRequest(from("10.1.1.1"), "t-global", 1)) passedA++;
    expect(passedA).toBe(1);
    // общий потолок = 1 × 20; клиент A потратил из него 1, ещё 19 разных клиентов проходят, 20-й — нет
    const others = Array.from({ length: 20 }, (_, i) => allowRequest(from(`10.2.0.${i}`), "t-global", 1));
    expect(others.filter(Boolean)).toHaveLength(19);
    expect(others[19]).toBe(false);
  });
});

describe("заготовка вебхука Ozon: тело не доверенное", () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  let orderId = "";
  beforeAll(async () => {
    orderId = (
      await prisma.order.create({
        data: {
          number: `WH-${suffix}`,
          customerName: "t",
          customerEmail: "t@example.com",
          customerPhone: "+79990000000",
          deliveryCity: "c",
          deliveryAddress: "address",
          totalAmount: 100,
          status: "PROCESSING",
          ozon: { create: { state: "CREATED", deliveryType: "PVZ", request: {} as Prisma.InputJsonValue, quote: {}, ozonOrderNumber: `WH-N-${suffix}`, postingNumbers: [`7777-${suffix.slice(-6)}-1`] } },
        },
      })
    ).id;
  });
  afterAll(async () => {
    await prisma.ozonOrder.deleteMany({ where: { orderId } });
    await prisma.order.deleteMany({ where: { id: orderId } });
  });

  it("TYPE_PING — ответ без обращения к Ozon; чужое отправление — игнор", async () => {
    on();
    const fake = fakeFetch({});
    vi.stubGlobal("fetch", fake.fetch);
    expect(await (await webhook.POST(post("/api/delivery/ozon/webhook", { message_type: "TYPE_PING" }))).json()).toMatchObject({ version: "1" });
    expect(await (await webhook.POST(post("/api/delivery/ozon/webhook", { posting_number: "1111-2222-3" }))).json()).toEqual({ result: true, ignored: true });
    expect(fake.fetch).not.toHaveBeenCalled();
  });

  it("известное отправление: статус берётся у Ozon (posting/fbs/get), а не из тела", async () => {
    on();
    const posting = `7777-${suffix.slice(-6)}-1`;
    const fake = fakeFetch({
      "/v4/posting/fbs/list": () => ({ body: { postings: [] } }),
      "/v3/posting/fbs/get": () => ({ body: { result: { posting_number: posting, status: "delivering" } } }),
      "/v1/returns/list": () => ({ body: { returns: [] } }),
    });
    vi.stubGlobal("fetch", fake.fetch);
    const res = await webhook.POST(post("/api/delivery/ozon/webhook", { message_type: "TYPE_STATE_CHANGED", posting_number: posting, new_state: "delivered" }));
    expect(res.status).toBe(200);
    expect(fake.count("/v3/posting/fbs/get")).toBe(1);
    expect((await prisma.ozonOrder.findUniqueOrThrow({ where: { orderId } })).status).toBe("delivering");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("SHIPPED");

    // Подписи нет — повтор в течение 2 минут квоту Ozon не тратит
    for (let i = 0; i < 5; i++) await webhook.POST(post("/api/delivery/ozon/webhook", { posting_number: posting }));
    expect(fake.count("/v3/posting/fbs/get")).toBe(1);
  });
});
