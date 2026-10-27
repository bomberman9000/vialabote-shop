// @vitest-environment node
// Оплата (Точка) -> заказ Ozon: через тот же syncOrderPayment, что вызывают вебхук, страница оплаты и
// «подметальщик». Заказ в Ozon — только после подтверждённого банком APPROVED, ровно один раз,
// сбой Ozon оплату не откатывает. База — настоящий PostgreSQL, банк и Ozon — поддельные.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { clearOzonCache } from "@/lib/delivery/ozon-service";
import { ozonAfterPayment } from "@/lib/delivery/ozon-orders";
import { checkoutReply, fakeFetch, stocksReply, type Handler } from "@/lib/delivery/__fixtures__/fake-ozon";
import { placeOnlineOrder, syncOrderPayment, type OrderRow, type SyncOutcome } from "./online-order";
import type { FetchLike, TochkaConfig } from "@/lib/tochka";

vi.mock("@/lib/delivery/ozon-token", () => ({
  createTokenStore: () => ({ getAccessToken: async () => "test-token", exchangeCode: async () => ({ expiresIn: 1, scope: null }) }),
}));

const HAS_DB = Boolean(process.env.DATABASE_URL);
const cfg: TochkaConfig = { token: "t", customerCode: "303256308", apiBase: "https://bank.test/uapi" };
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let categoryId = "";
const productIds: string[] = [];
const orderIds: string[] = [];
let seq = 0;

function bank(status: string, amountRub: number): FetchLike {
  return async (url) => {
    const id = String(url).split("/").pop();
    return new Response(JSON.stringify({ Data: { Operation: [{ operationId: id, status, amount: amountRub }] } }), { status: 200 });
  };
}

async function ozonOrder() {
  const n = ++seq;
  const p = await prisma.product.create({
    data: { title: `OOP ${suffix} ${n}`, slug: `oop-${suffix}-${n}`, description: "", price: 150000, imageUrl: "/x.png", stock: 5, status: "published", isActive: true, categoryId, ozonSku: String(910000 + n), ozonOfferId: `OOP-${n}` },
  });
  productIds.push(p.id);
  const o = await placeOnlineOrder(
    prisma,
    {
      number: `V-OOP${String(n).padStart(4, "0")}`,
      customerName: "Анна Иванова",
      customerEmail: "t@example.com",
      customerPhone: "+79991234567",
      deliveryCity: "Москва",
      deliveryAddress: "ПВЗ",
      totalAmount: 175000,
      deliveryMethod: "OZON_PVZ",
      deliveryPrice: 25000,
      deliveryMaxDate: new Date("2026-11-05T21:00:00Z"),
      ozon: {
        create: {
          deliveryType: "PVZ",
          request: { destination: { type: "PVZ", mapPointId: "42" }, recipient: { lastName: "Иванова", firstName: "Анна", phone: "+79991234567" } } as Prisma.InputJsonValue,
          quote: {},
        },
      },
    },
    [{ productId: p.id, title: p.title, price: 150000, quantity: 1 }],
  );
  orderIds.push(o.id);
  const paymentId = `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
  await prisma.order.update({ where: { id: o.id }, data: { paymentId } });
  const row = (await prisma.order.findUniqueOrThrow({ where: { id: o.id } })) as unknown as OrderRow;
  return { order: row, sku: Number(p.ozonSku), offer: p.ozonOfferId! };
}

function ozon(sku: number, offer: string, create: Handler) {
  return fakeFetch({
    "/v4/product/info/stocks": () => stocksReply([{ offer_id: offer, present: 3 }]),
    "/v2/delivery/checkout": () => checkoutReply([{ sku, quantity: 1, offer_id: offer }]),
    "/v2/order/create": create,
  });
}

/** Как tochka-runtime: onOutcome -> ozonAfterPayment; тест ждёт фоновую задачу. */
async function pay(order: OrderRow, status: string, amountRub: number) {
  let job: Promise<unknown> = Promise.resolve();
  const outcome = await syncOrderPayment(prisma, order, {
    cfg,
    fetchImpl: bank(status, amountRub),
    onOutcome: (o, out: SyncOutcome) => {
      job = ozonAfterPayment(o.id, out);
    },
  });
  await job;
  return outcome;
}

beforeAll(async () => {
  if (!HAS_DB) return;
  vi.stubEnv("OZON_APP_CLIENT_ID", "app");
  vi.stubEnv("OZON_APP_CLIENT_SECRET", "secret");
  categoryId = (await prisma.category.create({ data: { name: `OOP ${suffix}`, slug: `oop-cat-${suffix}` } })).id;
});
afterEach(() => {
  vi.unstubAllGlobals();
  clearOzonCache();
});
afterAll(async () => {
  if (!HAS_DB) return;
  vi.unstubAllEnvs();
  await prisma.stockChangeLog.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.ozonOrder.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
});

describe.skipIf(!HAS_DB)("оплата Точкой -> заказ Ozon", () => {
  it("APPROVED у банка -> PAID, затем заказ в Ozon; номер и отправление в БД; заказ сайта остаётся PAID", async () => {
    const { order, sku, offer } = await ozonOrder();
    const fake = ozon(sku, offer, () => ({ body: { order_number: `OZN-${sku}`, postings: [`OZN-${sku}-1`] } }));
    vi.stubGlobal("fetch", fake.fetch);
    expect(await pay(order, "APPROVED", 1750)).toBe("PAID");
    expect(await prisma.ozonOrder.findUniqueOrThrow({ where: { orderId: order.id } })).toMatchObject({ state: "CREATED", ozonOrderNumber: `OZN-${sku}` });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
    expect(fake.count("/v2/order/create")).toBe(1);
  });

  it("повторная сверка (вебхук, страница оплаты, «подметальщик») второго заказа в Ozon не создаёт", async () => {
    const { order, sku, offer } = await ozonOrder();
    const fake = ozon(sku, offer, () => ({ body: { order_number: `OZN-${sku}`, postings: [] } }));
    vi.stubGlobal("fetch", fake.fetch);
    await pay(order, "APPROVED", 1750);
    const again = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })) as unknown as OrderRow;
    expect(await pay(again, "APPROVED", 1750)).toBe("UNCHANGED");
    expect(fake.count("/v2/order/create")).toBe(1);
  });

  it("банк ещё не подтвердил (CREATED) — в Ozon ничего не уходит", async () => {
    const { order, sku, offer } = await ozonOrder();
    const fake = ozon(sku, offer, () => ({ body: {} }));
    vi.stubGlobal("fetch", fake.fetch);
    expect(await pay(order, "CREATED", 1750)).toBe("WAITING");
    expect(fake.fetch).not.toHaveBeenCalled();
    expect((await prisma.ozonOrder.findUniqueOrThrow({ where: { orderId: order.id } })).state).toBe("PENDING");
  });

  it("Ozon упал (503) -> оплата в силе (PAID, списание), доставка UNKNOWN для ручной сверки", async () => {
    const { order, sku, offer } = await ozonOrder();
    vi.stubGlobal("fetch", ozon(sku, offer, () => ({ status: 503, body: {} })).fetch);
    expect(await pay(order, "APPROVED", 1750)).toBe("PAID");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
    expect((await prisma.ozonOrder.findUniqueOrThrow({ where: { orderId: order.id } })).state).toBe("UNKNOWN");
    const log = await prisma.stockChangeLog.findMany({ where: { orderId: order.id } });
    expect(log.map((l) => l.reason).sort()).toEqual(["RESERVE", "WRITE_OFF"]);
  });

  it("оплата после отмены по таймеру (PAID_LATE) — в Ozon не отправляем, доставка на ручной разбор", async () => {
    const { order, sku, offer } = await ozonOrder();
    await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
    const cancelled = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })) as unknown as OrderRow;
    const fake = ozon(sku, offer, () => ({ body: { order_number: "X" } }));
    vi.stubGlobal("fetch", fake.fetch);
    expect(await pay(cancelled, "APPROVED", 1750)).toBe("PAID_LATE");
    expect(fake.count("/v2/order/create")).toBe(0);
    expect(await prisma.ozonOrder.findUniqueOrThrow({ where: { orderId: order.id } })).toMatchObject({ state: "FAILED", lastError: expect.stringContaining("после отмены") });
  });
});
