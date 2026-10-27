// @vitest-environment node
// Оформление заказа с доставкой Ozon: цена доставки считается сервером и входит в сумму платежа,
// заказ в Ozon при оформлении НЕ создаётся. Ozon и Точка — поддельные (fetch), база — настоящая.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { clearOzonCache, resetRequestLimits } from "@/lib/delivery/ozon-service";
import { checkoutReply, fakeFetch, stocksReply, unavailableReply } from "@/lib/delivery/__fixtures__/fake-ozon";

vi.mock("next-auth", () => ({ getServerSession: vi.fn().mockResolvedValue(null) }));
// Токен частного приложения не нужен: БД-строку токена делят все тестовые файлы.
vi.mock("@/lib/delivery/ozon-token", () => ({
  createTokenStore: () => ({ getAccessToken: async () => "test-token", exchangeCode: async () => ({ expiresIn: 1, scope: null }) }),
}));

const { POST } = await import("./route");

const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let categoryId = "";
const productIds: string[] = [];
let seq = 0;

function env(on: { ozon?: boolean; tochka?: boolean } = {}) {
  vi.stubEnv("OZON_APP_CLIENT_ID", on.ozon === false ? "" : "app");
  vi.stubEnv("OZON_APP_CLIENT_SECRET", on.ozon === false ? "" : "secret");
  vi.stubEnv("OZON_CLIENT_ID", "100001");
  vi.stubEnv("OZON_API_KEY", "key");
  vi.stubEnv("TOCHKA_API_TOKEN", on.tochka === false ? "" : "tochka-token");
  vi.stubEnv("TOCHKA_CUSTOMER_CODE", on.tochka === false ? "" : "300000092");
}

async function product(over: { ozonSku?: string | null } = {}) {
  const n = ++seq;
  const p = await prisma.product.create({
    data: {
      title: `ORZ ${suffix} ${n}`,
      slug: `orz-${suffix}-${n}`,
      description: "",
      price: 150000,
      imageUrl: "/x.png",
      stock: 5,
      status: "published",
      isActive: true,
      categoryId,
      ozonSku: over.ozonSku === undefined ? String(800000 + n) : over.ozonSku,
      ozonOfferId: `ORZ-${n}`,
    },
  });
  productIds.push(p.id);
  return p;
}

const body = (productId: string, delivery: unknown, phone = "8 (999) 123-45-67") => ({
  customerName: "Анна Иванова",
  customerEmail: "anna@example.com",
  customerPhone: phone,
  deliveryCity: "Самара",
  deliveryAddress: "ПВЗ Ozon, тестовый адрес",
  offerAccepted: true,
  items: [{ productId, quantity: 1 }],
  delivery,
});
const pvz = { provider: "OZON", destination: { type: "PVZ", mapPointId: "1020300040005" }, recipient: { lastName: "Иванова", firstName: "Анна" } };
const post = (b: unknown) => POST(new Request("http://localhost/api/orders", { method: "POST", body: JSON.stringify(b) }));

function world(p: { id: string; ozonSku: string | null; ozonOfferId: string | null }, checkout = checkoutReply([{ sku: Number(p.ozonSku), quantity: 1 }]), possible = true) {
  return fakeFetch({
    "/v1/delivery/check": () => ({ body: { is_possible: possible } }),
    "/v4/product/info/stocks": () => stocksReply([{ offer_id: p.ozonOfferId!, present: 4 }]),
    "/v2/delivery/checkout": () => checkout,
    "/uapi/acquiring/v1.0/payments": () => ({ body: { Data: { operationId: `op-${p.id}`, paymentLink: "https://pay.test/1" } } }),
  });
}

beforeAll(async () => {
  categoryId = (await prisma.category.create({ data: { name: `ORZ ${suffix}`, slug: `orz-cat-${suffix}` } })).id;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  clearOzonCache();
  resetRequestLimits();
});
afterAll(async () => {
  const orders = await prisma.order.findMany({ where: { items: { some: { productId: { in: productIds } } } }, select: { id: true } });
  const ids = orders.map((o) => o.id);
  await prisma.stockChangeLog.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.ozonOrder.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.order.deleteMany({ where: { id: { in: ids } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.category.delete({ where: { id: categoryId } });
});

describe("POST /api/orders — доставка Ozon", () => {
  it("цена доставки с сервера входит в сумму платежа; срок сохранён; заказ в Ozon пока не создан", async () => {
    env();
    const p = await product();
    const fake = world(p);
    vi.stubGlobal("fetch", fake.fetch);
    const res = await post(body(p.id, pvz));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.delivery).toEqual({ priceKopecks: 25000, maxDate: "2026-11-05T21:00:00.000Z" });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: json.orderId }, include: { ozon: true } });
    expect(order).toMatchObject({ totalAmount: 175000, deliveryPrice: 25000, deliveryMethod: "OZON_PVZ", status: "AWAITING_PAYMENT" });
    expect(order.deliveryMaxDate?.toISOString()).toBe("2026-11-05T21:00:00.000Z");
    expect(order.ozon).toMatchObject({ state: "PENDING", deliveryType: "PVZ", ozonOrderNumber: null });
    expect(order.ozon!.request).toEqual({
      destination: { type: "PVZ", mapPointId: "1020300040005" },
      recipient: { lastName: "Иванова", firstName: "Анна", phone: "+79991234567" },
    });
    // банк получил сумму с доставкой (рубли)
    expect(fake.bodies("/uapi/acquiring/v1.0/payments")[0].Data.amount).toBe(1750);
    expect(fake.count("/v2/order/create")).toBe(0);
  });

  it("клиент не может подсунуть цену доставки: лишние поля отбрасываются, сумма — из checkout", async () => {
    env();
    const p = await product();
    vi.stubGlobal("fetch", world(p).fetch);
    const res = await post(body(p.id, { ...pvz, priceKopecks: 1, maxDate: "2020-01-01" }));
    const order = await prisma.order.findUniqueOrThrow({ where: { id: (await res.json()).orderId } });
    expect(order.totalAmount).toBe(175000);
  });

  it("Ozon не везёт -> 409, заказ не создан, резерва нет", async () => {
    env();
    const p = await product();
    vi.stubGlobal("fetch", world(p, unavailableReply("BANNED_FOR_AREA")).fetch);
    const res = await post(body(p.id, pvz));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("BANNED_FOR_AREA");
    expect(await prisma.order.count({ where: { items: { some: { productId: p.id } } } })).toBe(0);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(5);
  });

  it("у номера нет аккаунта Ozon -> 409 до оплаты; проверяется номер из заказа, checkout не вызывается", async () => {
    env();
    const p = await product();
    const fake = world(p, undefined, false);
    vi.stubGlobal("fetch", fake.fetch);
    const res = await post(body(p.id, pvz));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("NO_OZON_ACCOUNT");
    expect(fake.bodies("/v1/delivery/check")).toEqual([{ client_phone: "+79991234567" }]);
    expect(fake.count("/v2/delivery/checkout")).toBe(0);
    expect(fake.count("/uapi/acquiring/v1.0/payments")).toBe(0);
  });

  const postFrom = (b: unknown, ip: string) =>
    POST(new Request("http://localhost/api/orders", { method: "POST", body: JSON.stringify(b), headers: { "x-forwarded-for": ip } }));

  it("номер заказа: два заказа в одну миллисекунду различаются и проходят формат страницы оплаты", async () => {
    env();
    const p = await product();
    vi.stubGlobal("fetch", world(p).fetch);
    const now = vi.spyOn(Date, "now").mockReturnValue(1_793_000_000_000);
    try {
      const a = await (await post(body(p.id, undefined))).json();
      const b = await (await post(body(p.id, undefined))).json();
      expect(a.orderNumber).not.toBe(b.orderNumber);
      for (const n of [a.orderNumber, b.orderNumber]) expect(n).toMatch(/^V-[A-Z0-9]{4,20}$/);
    } finally {
      now.mockRestore();
    }
  });

  it("частые попытки с одного адреса (разные номера) -> 429 после 10, Ozon не дёргается", async () => {
    env();
    const p = await product();
    const fake = world(p, undefined, false);
    vi.stubGlobal("fetch", fake.fetch);
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await postFrom(body(p.id, pvz, `+7999123${String(i).padStart(4, "0")}`), "10.7.7.7")).status);
    expect(codes.slice(0, 10).every((c) => c === 409)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
    expect(fake.count("/v1/delivery/check")).toBe(10);
  });

  it("один номер — не больше 5 проверок в час даже с разных адресов (перебор аккаунтов Ozon)", async () => {
    env();
    const p = await product();
    const fake = world(p, undefined, false);
    vi.stubGlobal("fetch", fake.fetch);
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await postFrom(body(p.id, pvz, "+79990005555"), `10.8.0.${i}`)).status);
    expect(codes).toEqual([409, 409, 409, 409, 409, 429, 429]);
    expect(fake.count("/v1/delivery/check")).toBe(5);
  });

  it("чужие попытки не блокируют владельца номера, у которого аккаунт Ozon есть", async () => {
    env();
    const p = await product();
    // аккаунт есть, но Ozon не везёт в эту точку -> 409 без создания заказа; номер не засчитывается
    const fake = world(p, unavailableReply("BANNED_FOR_AREA"), true);
    vi.stubGlobal("fetch", fake.fetch);
    const reasons: string[] = [];
    for (let i = 0; i < 7; i++) reasons.push((await (await postFrom(body(p.id, pvz, "+79990006666"), `10.9.0.${i}`)).json()).reason);
    expect(reasons).toEqual(Array(7).fill("BANNED_FOR_AREA"));
    expect(fake.count("/v1/delivery/check")).toBe(7);
  });

  it("товар без SKU Ozon -> 409 NOT_MAPPED", async () => {
    env();
    const p = await product({ ozonSku: null });
    vi.stubGlobal("fetch", world(p).fetch);
    const res = await post(body(p.id, pvz));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("NOT_MAPPED");
  });

  it("без онлайн-оплаты (Точка не настроена) Ozon недоступен — наложенного платежа нет", async () => {
    env({ tochka: false });
    const p = await product();
    const fake = world(p);
    vi.stubGlobal("fetch", fake.fetch);
    expect((await post(body(p.id, pvz))).status).toBe(400);
    expect(fake.fetch).not.toHaveBeenCalled();
  });

  it("Ozon выключен (нет OZON_APP_*): с delivery — 400, без delivery — заказ как раньше", async () => {
    env({ ozon: false });
    const p = await product();
    const fake = world(p);
    vi.stubGlobal("fetch", fake.fetch);
    expect((await post(body(p.id, pvz))).status).toBe(400);
    const plain = await post(body(p.id, undefined));
    expect(plain.status).toBe(200);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: (await plain.json()).orderId }, include: { ozon: true } });
    expect(order).toMatchObject({ totalAmount: 150000, deliveryMethod: null, deliveryPrice: null, ozon: null });
    expect(fake.count("/v2/delivery/checkout")).toBe(0);
  });

  it("городской телефон -> 400 (Ozon требует мобильный номер аккаунта)", async () => {
    env();
    const p = await product();
    vi.stubGlobal("fetch", world(p).fetch);
    expect((await post(body(p.id, pvz, "+7 846 222-33-44"))).status).toBe(400);
  });

  it("курьер при оформлении закрыт (координаты клиента не сверяются с адресом) — 400, в Ozon и банк не ходим", async () => {
    env();
    const p = await product();
    const fake = world(p, checkoutReply([{ sku: Number(p.ozonSku), quantity: 1 }], { type: "COURIER" }));
    vi.stubGlobal("fetch", fake.fetch);
    const courier = {
      provider: "OZON",
      destination: { type: "COURIER", latitude: 53.2, longitude: 50.15 },
      recipient: { lastName: "Иванова", firstName: "Анна" },
      courier: { city: "Самара", street: "Мориса Тореза", house: "103" },
    };
    const res = await post(body(p.id, courier));
    expect(res.status).toBe(400);
    expect(fake.fetch).not.toHaveBeenCalled();
    expect(await prisma.order.count({ where: { items: { some: { productId: p.id } } } })).toBe(0);
  });
});
