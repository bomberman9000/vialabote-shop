// @vitest-environment node
// Заказ Ozon на настоящем PostgreSQL с поддельным Ozon: создание только после оплаты, идемпотентность,
// сбои Ozon не трогают оплату, опрос статусов, отмена, невыкупы. Ни одного живого вызова.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { clearOzonCache, quoteCart } from "./ozon-service";
import { cancelOzonOrder, createOzonOrderForPaid, MAX_CREATE_ATTEMPTS, retryOzonOrder, syncOzonOrders, type OzonOrderRequest } from "./ozon-orders";
import { checkoutReply, fakeFetch, stocksReply, testOzon, unavailableReply, type Handler } from "./__fixtures__/fake-ozon";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let categoryId = "";
const productIds: string[] = [];
const orderIds: string[] = [];
let seq = 0;

const CREATE = "/v2/order/create";
const request = (over: Partial<OzonOrderRequest> = {}): OzonOrderRequest => ({
  destination: { type: "PVZ", mapPointId: "1020300040005" },
  recipient: { lastName: "Иванова", firstName: "Анна", phone: "+79991234567" },
  ...over,
});

async function product(over: { ozonSku?: string | null; ozonOfferId?: string | null; price?: number } = {}) {
  const n = ++seq;
  const p = await prisma.product.create({
    data: {
      title: `OZ ${suffix} ${n}`,
      slug: `oz-${suffix}-${n}`,
      description: "",
      price: over.price ?? 150000,
      imageUrl: "/x.png",
      stock: 10,
      status: "published",
      isActive: true,
      categoryId,
      ozonSku: over.ozonSku === undefined ? String(700000 + n) : over.ozonSku,
      ozonOfferId: over.ozonOfferId === undefined ? `VL-${n}` : over.ozonOfferId,
    },
  });
  productIds.push(p.id);
  return p;
}

type OzonExtra = Partial<Pick<Prisma.OzonOrderCreateWithoutOrderInput, "claimedAt" | "ozonOrderNumber" | "postingNumbers">>;

async function order({ status = "PAID", state = "PENDING", qty = 1, extra = {} }: { status?: string; state?: string; qty?: number; extra?: OzonExtra } = {}) {
  const p = await product();
  const o = await prisma.order.create({
    data: {
      number: `OZ-${suffix}-${++seq}`,
      customerName: "Анна Иванова",
      customerEmail: "t@example.com",
      customerPhone: "+79991234567",
      deliveryCity: "Москва",
      deliveryAddress: "ПВЗ Ozon",
      totalAmount: p.price * qty + 25000,
      deliveryMethod: "OZON_PVZ",
      deliveryPrice: 25000,
      deliveryMaxDate: new Date("2026-11-05T21:00:00Z"),
      status,
      items: { create: [{ productId: p.id, title: p.title, price: p.price, quantity: qty }] },
      ozon: { create: { state, deliveryType: "PVZ", request: request() as unknown as Prisma.InputJsonValue, quote: {}, ...extra } },
    },
    include: { ozon: true },
  });
  orderIds.push(o.id);
  return { order: o, product: p, sku: Number(p.ozonSku), offer: p.ozonOfferId! };
}

const ozonRow = (orderId: string) => prisma.ozonOrder.findUniqueOrThrow({ where: { orderId } });
const orderStatus = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).status;

function happy(sku: number, offer: string, qty = 1, extra: Record<string, Handler> = {}) {
  return fakeFetch({
    "/v4/product/info/stocks": () => stocksReply([{ offer_id: offer, present: 5 }]),
    "/v2/delivery/checkout": () => checkoutReply([{ sku, quantity: qty, offer_id: offer }]),
    [CREATE]: () => ({ body: { order_number: `OZN-${sku}`, postings: [`OZN-${sku}-1`] } }),
    ...extra,
  });
}

beforeAll(async () => {
  if (!HAS_DB) return;
  categoryId = (await prisma.category.create({ data: { name: `OZ ${suffix}`, slug: `oz-cat-${suffix}` } })).id;
});
afterAll(async () => {
  if (!HAS_DB) return;
  await prisma.ozonOrder.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
});

describe.skipIf(!HAS_DB)("Ozon: расчёт корзины", () => {
  it("цена и максимальный срок из checkout; в Ozon уходят sku (без offer_id), точка и схема FBS", async () => {
    clearOzonCache();
    const p = await product();
    const fake = happy(Number(p.ozonSku), p.ozonOfferId!, 2);
    const q = await quoteCart(testOzon(fake), { lines: [{ productId: p.id, quantity: 2 }], destination: { type: "PVZ", mapPointId: "55" }, phone: "8 999 123 45 67" });
    expect(q).toMatchObject({ available: true, priceKopecks: 25000, maxDate: "2026-11-05T21:00:00Z", deliveryType: "PVZ" });
    expect(fake.bodies("/v2/delivery/checkout")[0]).toEqual({
      buyer_phone: "79991234567", // Ozon: только цифры
      delivery_schema: "FBS",
      delivery_type: { pick_up: { map_point_id: 55 } },
      items: [{ sku: Number(p.ozonSku), quantity: 2 }], // sku ИЛИ offer_id: оба Ozon отклоняет
    });
  });

  it("товар без SKU Ozon -> NOT_MAPPED, в Ozon не ходим", async () => {
    const p = await product({ ozonSku: null });
    const fake = fakeFetch({});
    const q = await quoteCart(testOzon(fake), { lines: [{ productId: p.id, quantity: 1 }], destination: { type: "PVZ", mapPointId: "55" } });
    expect(q).toEqual({ available: false, reason: "NOT_MAPPED", productIds: [p.id] });
    expect(fake.fetch).not.toHaveBeenCalled();
  });

  it("на FBS-складе меньше, чем в корзине -> OUT_OF_STOCK_FBS, checkout не вызывается", async () => {
    clearOzonCache();
    const p = await product();
    const fake = fakeFetch({ "/v4/product/info/stocks": () => stocksReply([{ offer_id: p.ozonOfferId!, present: 3, reserved: 2 }]) });
    const q = await quoteCart(testOzon(fake), { lines: [{ productId: p.id, quantity: 2 }], destination: { type: "PVZ", mapPointId: "55" } });
    expect(q).toMatchObject({ available: false, reason: "OUT_OF_STOCK_FBS" });
    expect(fake.count("/v2/delivery/checkout")).toBe(0);
  });

  it("Ozon вернул не все позиции -> PARTIAL; курьер — координаты в checkout", async () => {
    clearOzonCache();
    const p = await product();
    const fake = fakeFetch({
      "/v4/product/info/stocks": () => stocksReply([{ offer_id: p.ozonOfferId!, present: 9 }]),
      "/v2/delivery/checkout": () => checkoutReply([{ sku: Number(p.ozonSku), quantity: 1 }], { type: "COURIER" }),
    });
    const q = await quoteCart(testOzon(fake), { lines: [{ productId: p.id, quantity: 3 }], destination: { type: "COURIER", latitude: 53.2, longitude: 50.1 } });
    expect(q).toEqual({ available: false, reason: "PARTIAL" });
    expect(fake.bodies("/v2/delivery/checkout")[0].delivery_type).toEqual({ courier: { coordinates: { latitude: 53.2, longitude: 50.1 } } });
  });
});

describe.skipIf(!HAS_DB)("Ozon: заказ создаётся только после оплаты и только один раз", () => {
  it("PAID -> заказ в Ozon, номер и отправления в БД; заказ сайта остаётся PAID (его ждёт страница оплаты)", async () => {
    clearOzonCache();
    const { order: o, sku, offer } = await order();
    const fake = happy(sku, offer);
    const r = await createOzonOrderForPaid(o.id, testOzon(fake));
    expect(r).toEqual({ done: true, ozonOrderNumber: `OZN-${sku}`, postingNumbers: [`OZN-${sku}-1`] });
    expect(await ozonRow(o.id)).toMatchObject({ state: "CREATED", ozonOrderNumber: `OZN-${sku}`, postingNumbers: [`OZN-${sku}-1`], attempts: 1, lastError: null });
    expect(await orderStatus(o.id)).toBe("PAID");

    const body = fake.bodies(CREATE)[0];
    expect(body.buyer).toEqual({ first_name: "Анна", last_name: "Иванова", phone: "79991234567" }); // Ozon: только цифры
    expect(body.recipient).toEqual({ recipient_first_name: "Анна", recipient_last_name: "Иванова", recipient_phone: "79991234567" });
    expect(body.delivery).toEqual({ pick_up: { map_point_id: 1020300040005 } });
    expect(body.delivery_schema).toBe("FBS");
    expect(body.splits).toEqual([
      {
        delivery_method: {
          delivery_method_id: 501,
          delivery_type: "PVZ",
          logistic_date_range: { from: "2026-11-01T00:00:00Z", to: "2026-11-04T00:00:00Z" },
          timeslot_id: 9001,
          price: { units: 250, nanos: 0, currency_code: "RUB" },
        },
        items: [{ sku, quantity: 1, price: { units: 1500, nanos: 0, currency_code: "RUB" } }],
        warehouse_id: 777,
      },
    ]);
  });

  it("повтор (вебхук пришёл дважды) — второй order/create не уходит", async () => {
    clearOzonCache();
    const { order: o, sku, offer } = await order();
    const fake = happy(sku, offer);
    await createOzonOrderForPaid(o.id, testOzon(fake));
    const again = await createOzonOrderForPaid(o.id, testOzon(fake));
    expect(again.done).toBe(false);
    expect(fake.count(CREATE)).toBe(1);
  });

  it("два параллельных вызова — один заказ в Ozon", async () => {
    clearOzonCache();
    const { order: o, sku, offer } = await order();
    const fake = happy(sku, offer);
    const [a, b] = await Promise.all([createOzonOrderForPaid(o.id, testOzon(fake)), createOzonOrderForPaid(o.id, testOzon(fake))]);
    expect([a.done, b.done].filter(Boolean)).toHaveLength(1);
    expect(fake.count(CREATE)).toBe(1);
  });

  it("не оплачен (AWAITING_PAYMENT) — в Ozon ничего не уходит", async () => {
    const { order: o } = await order({ status: "AWAITING_PAYMENT" });
    const fake = fakeFetch({});
    const r = await createOzonOrderForPaid(o.id, testOzon(fake));
    expect(r).toMatchObject({ done: false });
    expect(fake.fetch).not.toHaveBeenCalled();
    expect((await ozonRow(o.id)).state).toBe("PENDING");
  });

  it("Ozon отказал (400) -> FAILED «доставка не создана», заказ остаётся PAID, в ошибке нет данных покупателя", async () => {
    clearOzonCache();
    const { order: o, sku, offer } = await order();
    const fake = happy(sku, offer, 1, { [CREATE]: () => ({ status: 400, body: { code: 3, message: "invalid phone +79991234567 Иванова" } }) });
    const r = await createOzonOrderForPaid(o.id, testOzon(fake));
    expect(r).toMatchObject({ done: false, state: "FAILED" });
    const row = await ozonRow(o.id);
    expect(row.state).toBe("FAILED");
    expect(row.lastError).toBe("Ozon: POST /v2/order/create -> HTTP 400 (3)");
    expect(row.lastError).not.toMatch(/7999|Иванова/);
    expect(await orderStatus(o.id)).toBe("PAID");
  });

  it("таймаут на order/create -> UNKNOWN (не повторяем сами); повтор только после проверки кабинета", async () => {
    clearOzonCache();
    const { order: o, sku, offer } = await order();
    const fake = happy(sku, offer, 1, { [CREATE]: () => new Error("The operation was aborted due to timeout") });
    const r = await createOzonOrderForPaid(o.id, testOzon(fake));
    expect(r).toMatchObject({ state: "UNKNOWN" });
    expect(await orderStatus(o.id)).toBe("PAID");
    expect(fake.count(CREATE)).toBe(1);
    // опрос UNKNOWN не трогает
    await syncOzonOrders(testOzon(fake), { orderIds: [o.id] });
    expect(fake.count(CREATE)).toBe(1);
    expect(await retryOzonOrder(o.id)).toMatchObject({ done: false, state: "UNKNOWN" });
    expect((await ozonRow(o.id)).state).toBe("UNKNOWN");
  });

  it("429 после всех повторов -> PENDING, попыткой не считается: квота не переводит оплаченный заказ в FAILED", async () => {
    clearOzonCache();
    const { order: o, sku, offer } = await order();
    const fake = happy(sku, offer, 1, { [CREATE]: () => ({ status: 429, body: {} }) });
    const ozon = testOzon(fake);
    expect(await createOzonOrderForPaid(o.id, ozon)).toMatchObject({ state: "PENDING" });
    expect(fake.count(CREATE)).toBe(4); // 1 + 3 повтора с паузой
    for (let i = 0; i < MAX_CREATE_ATTEMPTS + 1; i++) await createOzonOrderForPaid(o.id, ozon);
    expect(await ozonRow(o.id)).toMatchObject({ state: "PENDING", attempts: 0 });
    expect(await orderStatus(o.id)).toBe("PAID");
  });

  it("сеть до отправки order/create — повтор безопасен, но после лимита попыток -> FAILED", async () => {
    clearOzonCache();
    const { order: o, offer } = await order();
    const fake = fakeFetch({
      "/v4/product/info/stocks": () => stocksReply([{ offer_id: offer, present: 5 }]),
      "/v2/delivery/checkout": () => new Error("ECONNRESET"),
    });
    const ozon = testOzon(fake);
    for (let i = 0; i < MAX_CREATE_ATTEMPTS; i++) await createOzonOrderForPaid(o.id, ozon);
    expect(await ozonRow(o.id)).toMatchObject({ state: "FAILED", attempts: MAX_CREATE_ATTEMPTS });
    expect(fake.count(CREATE)).toBe(0);
    expect(await orderStatus(o.id)).toBe("PAID");
  });

  it("на момент оплаты Ozon уже не везёт -> FAILED с причиной checkout, order/create не вызывается", async () => {
    clearOzonCache();
    const { order: o, offer } = await order();
    const fake = fakeFetch({
      "/v4/product/info/stocks": () => stocksReply([{ offer_id: offer, present: 5 }]),
      "/v2/delivery/checkout": () => unavailableReply("BANNED_FOR_AREA"),
    });
    await createOzonOrderForPaid(o.id, testOzon(fake));
    expect(await ozonRow(o.id)).toMatchObject({ state: "FAILED", lastError: "checkout: BANNED_FOR_AREA" });
    expect(fake.count(CREATE)).toBe(0);
  });

  it("после FAILED админ повторяет — заказ создаётся", async () => {
    clearOzonCache();
    const { order: o, sku, offer } = await order({ state: "FAILED" });
    const fake = happy(sku, offer);
    const { getOzon } = await import("./ozon-service");
    expect(getOzon()).toBeNull(); // без env retryOzonOrder сам в Ozon не пойдёт
    expect(await retryOzonOrder(o.id)).toMatchObject({ done: false, state: "DISABLED" });
    expect((await ozonRow(o.id)).state).toBe("PENDING");
    expect(await createOzonOrderForPaid(o.id, testOzon(fake))).toMatchObject({ done: true });
  });
});

describe.skipIf(!HAS_DB)("Ozon: опрос статусов и возвраты", () => {
  it("опрос доводит оплаченный PENDING и помечает зависший CREATING как UNKNOWN", async () => {
    clearOzonCache();
    const pending = await order();
    const stuck = await order({ state: "CREATING", extra: { claimedAt: new Date(Date.now() - 60 * 60_000) } });
    const fake = happy(pending.sku, pending.offer);
    const report = await syncOzonOrders(testOzon(fake), { orderIds: [pending.order.id, stuck.order.id] });
    expect(report).toMatchObject({ created: 1, stale: 1 });
    expect((await ozonRow(stuck.order.id)).state).toBe("UNKNOWN");
    expect((await ozonRow(pending.order.id)).state).toBe("CREATED");
  });

  it("статусы отправлений: недостающие номера из v4/posting/fbs/list; delivering -> SHIPPED; delivered -> COMPLETED", async () => {
    const { order: o } = await order({ status: "PROCESSING", state: "CREATED", extra: { ozonOrderNumber: `N-${suffix}-a`, postingNumbers: [] } });
    let status = "delivering";
    const fake = fakeFetch({
      "/v4/posting/fbs/list": (b) => ({ body: { postings: [{ posting_number: `${b.filter.order_numbers[0]}-1`, order_number: b.filter.order_numbers[0] }], has_next: false } }),
      "/v3/posting/fbs/get": (b) => ({ body: { result: { posting_number: b.posting_number, status, tracking_number: "TRK1" } } }),
      "/v1/returns/list": () => ({ body: { returns: [] } }),
    });
    await syncOzonOrders(testOzon(fake), { orderIds: [o.id] });
    expect(await ozonRow(o.id)).toMatchObject({ postingNumbers: [`N-${suffix}-a-1`], status: "delivering" });
    expect(await orderStatus(o.id)).toBe("SHIPPED");
    expect(fake.bodies("/v4/posting/fbs/list")[0].filter.order_numbers).toEqual([`N-${suffix}-a`]);

    status = "delivered";
    await syncOzonOrders(testOzon(fake), { orderIds: [o.id] });
    expect(await orderStatus(o.id)).toBe("COMPLETED");
    expect((await ozonRow(o.id)).refundState).toBeNull();
  });

  it("невыкуп (returns/list) -> refundState REQUIRED; Ozon сам отменил -> заказ CANCELLED", async () => {
    const { order: o, sku } = await order({ status: "SHIPPED", state: "CREATED", extra: { ozonOrderNumber: `N-${suffix}-b`, postingNumbers: [`N-${suffix}-b-1`] } });
    const fake = fakeFetch({
      "/v4/posting/fbs/list": () => ({ body: { postings: [] } }),
      "/v3/posting/fbs/get": (b) => ({ body: { result: { posting_number: b.posting_number, status: "cancelled" } } }),
      "/v1/returns/list": (b) => ({ body: { returns: [{ id: 1, type: "Cancellation", posting_number: b.filter.posting_numbers[0], product: { sku, quantity: 1 }, visual: { status: { sys_name: "ReturnedToSeller" } } }] } }),
    });
    await syncOzonOrders(testOzon(fake), { orderIds: [o.id] });
    const row = await ozonRow(o.id);
    expect(row).toMatchObject({ state: "CANCELLED", status: "cancelled", refundState: "REQUIRED" });
    expect(row.returns).toEqual([expect.objectContaining({ type: "Cancellation", sku, quantity: 1 })]);
    expect(await orderStatus(o.id)).toBe("CANCELLED");
  });
});

describe.skipIf(!HAS_DB)("Ozon: отмена — cancel/check -> cancel -> status; деньги только после подтверждения", () => {
  it("нельзя отменить -> v1/order/cancel не вызывается", async () => {
    const { order: o } = await order({ status: "PROCESSING", state: "CREATED", extra: { ozonOrderNumber: `N-${suffix}-c`, postingNumbers: [] } });
    const fake = fakeFetch({ "/v1/order/cancel/check": () => ({ body: { cancellable: false, postings: [{ posting_number: "p", cancellable: false, why_not_cancellable: "уже в пути" }] } }) });
    expect(await cancelOzonOrder(o.id, {}, testOzon(fake))).toEqual({ ok: false, reason: "Ozon: отмена невозможна — уже в пути" });
    expect(fake.count("/v1/order/cancel")).toBe(0);
    expect((await ozonRow(o.id)).state).toBe("CREATED");
  });

  it("отмена подтверждена сразу -> CANCELLED, refundState REQUIRED, причина 508 по умолчанию", async () => {
    const { order: o } = await order({ status: "PROCESSING", state: "CREATED", extra: { ozonOrderNumber: `N-${suffix}-d`, postingNumbers: [] } });
    const fake = fakeFetch({
      "/v1/order/cancel/check": () => ({ body: { cancellable: true } }),
      "/v1/cancel-reason/list-by-order": () => ({ body: { reasons: [{ id: 504, name: "x" }, { id: 508, name: "y" }] } }),
      "/v1/order/cancel": () => ({ body: { message: "ok" } }),
      "/v1/order/cancel/status": () => ({ body: { state: "Подтверждена" } }),
    });
    expect(await cancelOzonOrder(o.id, {}, testOzon(fake))).toEqual({ ok: true, state: "CANCELLED", cancelState: "Подтверждена" });
    expect(fake.bodies("/v1/order/cancel")[0]).toEqual({ order_number: `N-${suffix}-d`, reason_id: 508 });
    expect(await ozonRow(o.id)).toMatchObject({ state: "CANCELLED", refundState: "REQUIRED" });
    expect(await orderStatus(o.id)).toBe("CANCELLED");
  });

  it("на подтверждении -> CANCELLING, деньги не трогаем; опрос получает «Подтверждена»", async () => {
    const { order: o } = await order({ status: "PROCESSING", state: "CREATED", extra: { ozonOrderNumber: `N-${suffix}-e`, postingNumbers: [] } });
    let state = "На подтверждении";
    const fake = fakeFetch({
      "/v1/order/cancel/check": () => ({ body: { cancellable: true } }),
      "/v1/cancel-reason/list-by-order": () => ({ body: { reasons: [{ id: 505 }] } }),
      "/v1/order/cancel": () => ({ body: {} }),
      "/v1/order/cancel/status": () => ({ body: { state } }),
      "/v4/posting/fbs/list": () => ({ body: { postings: [] } }),
    });
    expect(await cancelOzonOrder(o.id, { reasonId: 999 }, testOzon(fake))).toMatchObject({ ok: true, state: "CANCELLING" });
    expect(fake.bodies("/v1/order/cancel")[0].reason_id).toBe(505); // 999 нет в справочнике -> первая доступная
    expect(await ozonRow(o.id)).toMatchObject({ state: "CANCELLING", refundState: null });
    expect(await orderStatus(o.id)).toBe("PROCESSING");

    state = "Подтверждена";
    await syncOzonOrders(testOzon(fake), { orderIds: [o.id] });
    expect(await ozonRow(o.id)).toMatchObject({ state: "CANCELLED", refundState: "REQUIRED" });
    expect(await orderStatus(o.id)).toBe("CANCELLED");
  });

  it("заказа в Ozon ещё нет (PENDING, оплачен) -> отмена локально, без вызовов Ozon, нужен возврат", async () => {
    const { order: o } = await order({ state: "PENDING" });
    const fake = fakeFetch({});
    expect(await cancelOzonOrder(o.id, {}, testOzon(fake))).toMatchObject({ ok: true, state: "CANCELLED" });
    expect(fake.fetch).not.toHaveBeenCalled();
    expect(await ozonRow(o.id)).toMatchObject({ state: "CANCELLED", refundState: "REQUIRED" });
    // после локальной отмены создание уже не начнётся
    expect(await createOzonOrderForPaid(o.id, testOzon(happy(1, "x")))).toMatchObject({ done: false });
  });
});
