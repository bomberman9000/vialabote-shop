import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

// Реальная БД, фиктивный fetch вместо ЮKassa: никаких ключей и реальных платежей.
process.env.YOOKASSA_SHOP_ID = "test-shop";
process.env.YOOKASSA_SECRET_KEY = "test-secret";

const suffix = Date.now();
const orderIds: string[] = [];
let categoryId = "";
let productId = "";

async function makeOrder(paymentId: string, totalAmount = 57000) {
  const o = await prisma.order.create({
    data: {
      number: `T-${suffix}-${orderIds.length}`,
      status: "AWAITING_PAYMENT",
      customerName: "Тест",
      customerEmail: "t@example.com",
      customerPhone: "+70000000000",
      deliveryCity: "Москва",
      deliveryAddress: "Тестовая, 1",
      totalAmount,
      paymentId,
      items: { create: [{ productId, title: "Т", price: totalAmount, quantity: 1 }] },
    },
  });
  orderIds.push(o.id);
  return o;
}

function mockYooKassa(payment: Record<string, unknown> | null, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok: status === 200,
    status,
    json: async () => payment,
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function hook(body: unknown, event = "payment.succeeded") {
  return POST(
    new Request("http://localhost/api/payment/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify({ event, object: body }),
    }),
  );
}

const statusOf = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).status;

beforeAll(async () => {
  const c = await prisma.category.create({ data: { name: "TEST-Pay", slug: `test-pay-${suffix}` } });
  categoryId = c.id;
  const p = await prisma.product.create({
    data: { title: "PayTest", slug: `pay-test-${suffix}`, description: "", price: 57000, imageUrl: "/x", categoryId },
  });
  productId = p.id;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  const ids = orderIds.splice(0);
  await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.order.deleteMany({ where: { id: { in: ids } } });
});

afterAll(async () => {
  await prisma.product.delete({ where: { id: productId } });
  await prisma.category.delete({ where: { id: categoryId } });
});

describe("POST /api/payment/webhook — не доверяет телу запроса", () => {
  it("поддельный webhook: ЮKassa говорит pending -> заказ НЕ оплачен", async () => {
    const o = await makeOrder(`pay-${suffix}-a`);
    mockYooKassa({
      id: o.paymentId, status: "pending", paid: false,
      amount: { value: "570.00", currency: "RUB" }, metadata: { orderId: o.id },
    });
    const res = await hook({ id: o.paymentId, status: "succeeded", metadata: { orderId: o.id } });
    expect(res.status).toBe(200);
    expect(await statusOf(o.id)).toBe("AWAITING_PAYMENT");
  });

  it("неизвестный paymentId -> игнор, к ЮKassa не обращаемся", async () => {
    const f = mockYooKassa(null);
    const res = await hook({ id: "does-not-exist", status: "succeeded" });
    expect(res.status).toBe(200);
    expect(f).not.toHaveBeenCalled();
  });

  it("orderId в теле игнорируется: чужой orderId не оплачивает чужой заказ", async () => {
    const victim = await makeOrder(`pay-${suffix}-victim`);
    const mine = await makeOrder(`pay-${suffix}-mine`);
    mockYooKassa({
      id: mine.paymentId, status: "succeeded", paid: true,
      amount: { value: "570.00", currency: "RUB" }, metadata: { orderId: mine.id },
    });
    await hook({ id: mine.paymentId, status: "succeeded", metadata: { orderId: victim.id } });
    expect(await statusOf(victim.id)).toBe("AWAITING_PAYMENT");
    expect(await statusOf(mine.id)).toBe("PAID");
  });

  it.each([
    ["сумма не совпадает", { amount: { value: "1.00", currency: "RUB" } }],
    ["валюта не RUB", { amount: { value: "570.00", currency: "USD" } }],
    ["платёж привязан к другому заказу", { metadata: { orderId: "someone-else" } }],
  ])("%s -> заказ не оплачен", async (_n, override) => {
    const o = await makeOrder(`pay-${suffix}-${Math.random()}`);
    mockYooKassa({
      id: o.paymentId, status: "succeeded", paid: true,
      amount: { value: "570.00", currency: "RUB" }, metadata: { orderId: o.id }, ...override,
    });
    await hook({ id: o.paymentId, status: "succeeded" });
    expect(await statusOf(o.id)).toBe("AWAITING_PAYMENT");
  });

  it("битый JSON и тело без id -> 400", async () => {
    expect((await hook("{not json")).status).toBe(400);
    expect((await hook({})).status).toBe(400);
  });

  it("не удалось проверить платёж -> 502 (ЮKassa повторит), заказ не меняется", async () => {
    const o = await makeOrder(`pay-${suffix}-err`);
    mockYooKassa(null, 500);
    const res = await hook({ id: o.paymentId });
    expect(res.status).toBe(502);
    expect(await statusOf(o.id)).toBe("AWAITING_PAYMENT");
  });
});

describe("POST /api/payment/webhook — идемпотентность и порядок событий", () => {
  const paid = (o: { id: string; paymentId: string | null }) => ({
    id: o.paymentId, status: "succeeded", paid: true,
    amount: { value: "570.00", currency: "RUB" }, metadata: { orderId: o.id },
  });

  it("оплата -> PAID; повторный webhook безвреден", async () => {
    const o = await makeOrder(`pay-${suffix}-dup`);
    mockYooKassa(paid(o));
    expect((await hook({ id: o.paymentId })).status).toBe(200);
    expect(await statusOf(o.id)).toBe("PAID");
    expect((await hook({ id: o.paymentId })).status).toBe(200);
    expect(await statusOf(o.id)).toBe("PAID");
  });

  it("canceled, пришедший после succeeded, не отменяет оплаченный заказ", async () => {
    const o = await makeOrder(`pay-${suffix}-ooo`);
    mockYooKassa(paid(o));
    await hook({ id: o.paymentId });
    mockYooKassa({ ...paid(o), status: "canceled", paid: false });
    await hook({ id: o.paymentId }, "payment.canceled");
    expect(await statusOf(o.id)).toBe("PAID");
  });

  it("отмена платежа -> CANCELLED", async () => {
    const o = await makeOrder(`pay-${suffix}-cancel`);
    mockYooKassa({ ...paid(o), status: "canceled", paid: false });
    await hook({ id: o.paymentId }, "payment.canceled");
    expect(await statusOf(o.id)).toBe("CANCELLED");
  });
});
