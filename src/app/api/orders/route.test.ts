import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// getServerSession() reads next/headers, which requires a real Next.js
// request-scope not present when calling a route handler directly from
// Vitest. Мокаем анонимной сессией (checkout работает и без логина — см.
// `userId: session?.user ? ... : undefined` в route.ts).
vi.mock("next-auth", () => ({ getServerSession: vi.fn().mockResolvedValue(null) }));

const { POST } = await import("./route");

// Никакого мока Prisma — реальная dev.db, собственные тестовые сущности,
// полная очистка. YOOKASSA_* не настроены в тестовом окружении, поэтому
// заказ создаётся сразу в статусе NEW без похода во внешний платёжный шлюз.

const suffix = Date.now();
let categoryId: string;
const productIds: string[] = [];
const orderIds: string[] = [];

async function makeProduct(overrides: { price: number; oldPrice?: number | null; title?: string }) {
  const p = await prisma.product.create({
    data: {
      title: overrides.title ?? `OrderTest ${suffix}-${productIds.length}`,
      slug: `order-test-${suffix}-${productIds.length}`,
      description: "",
      price: overrides.price,
      oldPrice: overrides.oldPrice ?? null,
      imageUrl: "/images/placeholder.svg",
      categoryId,
    },
  });
  productIds.push(p.id);
  return p;
}

function checkoutBody(items: { productId: string; quantity: number }[], extra: Record<string, unknown> = {}) {
  return {
    customerName: "Тест Тестов",
    customerEmail: "order-test@example.com",
    customerPhone: "+70000000000",
    deliveryCity: "Москва",
    deliveryAddress: "Тестовая, 1",
    items,
    ...extra,
  };
}

function req(body: unknown) {
  return new Request("http://localhost/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const category = await prisma.category.create({
    data: { name: "TEST-Orders", slug: `test-orders-${suffix}` },
  });
  categoryId = category.id;
});

afterEach(async () => {
  // Удаляем оба уровня СРАЗУ здесь — splice() опустошает orderIds, поэтому
  // если Order не удалить в этом же вызове, afterAll ниже уже не увидит эти
  // id и заказы останутся висеть в реальной dev.db (ровно так и утекало).
  const ids = orderIds.splice(0);
  await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.order.deleteMany({ where: { id: { in: ids } } });
});

afterAll(async () => {
  await prisma.discount.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.category.delete({ where: { id: categoryId } });
});

async function getOrderTotal(orderId: string) {
  return prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
}

describe("POST /api/orders — server-authoritative price (никогда не доверяет клиенту)", () => {
  it("клиент не может передать price в теле запроса — схема его даже не принимает", async () => {
    const product = await makeProduct({ price: 100000 });
    const res = await POST(
      req(
        checkoutBody([
          // @ts-expect-error — намеренно шлём forged price, чтобы доказать, что он игнорируется
          { productId: product.id, quantity: 1, price: 1 },
        ]),
      ),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    orderIds.push(json.orderId);

    const order = await getOrderTotal(json.orderId);
    expect(order.items[0].price).toBe(100000); // не 1 — forged price проигнорирован
    expect(order.totalAmount).toBe(100000);
  });

  it("несуществующий productId -> 400, заказ не создаётся", async () => {
    const res = await POST(req(checkoutBody([{ productId: "does-not-exist", quantity: 1 }])));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/orders — effectivePrice() как единственный источник итоговой цены", () => {
  it("товар без скидки -> price = product.price", async () => {
    const product = await makeProduct({ price: 250000 });
    const res = await POST(req(checkoutBody([{ productId: product.id, quantity: 2 }])));
    const json = await res.json();
    orderIds.push(json.orderId);

    const order = await getOrderTotal(json.orderId);
    expect(order.items[0].price).toBe(250000);
    expect(order.totalAmount).toBe(500000);
  });

  it("скидка ещё не началась -> base price", async () => {
    const product = await makeProduct({ price: 100000 });
    await prisma.discount.create({
      data: {
        productId: product.id,
        type: "percent",
        value: 30,
        startsAt: new Date("2099-01-01"),
        endsAt: null,
      },
    });

    const res = await POST(req(checkoutBody([{ productId: product.id, quantity: 1 }])));
    const json = await res.json();
    orderIds.push(json.orderId);

    const order = await getOrderTotal(json.orderId);
    expect(order.items[0].price).toBe(100000);
  });

  it("скидка активна (percent) -> discounted price", async () => {
    const product = await makeProduct({ price: 100000 });
    await prisma.discount.create({
      data: { productId: product.id, type: "percent", value: 25, startsAt: null, endsAt: null },
    });

    const res = await POST(req(checkoutBody([{ productId: product.id, quantity: 1 }])));
    const json = await res.json();
    orderIds.push(json.orderId);

    const order = await getOrderTotal(json.orderId);
    expect(order.items[0].price).toBe(75000);
    expect(order.totalAmount).toBe(75000);
  });

  it("скидка активна (fixed) -> discounted price", async () => {
    const product = await makeProduct({ price: 100000 });
    await prisma.discount.create({
      data: { productId: product.id, type: "fixed", value: 15000, startsAt: null, endsAt: null },
    });

    const res = await POST(req(checkoutBody([{ productId: product.id, quantity: 3 }])));
    const json = await res.json();
    orderIds.push(json.orderId);

    const order = await getOrderTotal(json.orderId);
    expect(order.items[0].price).toBe(85000);
    expect(order.totalAmount).toBe(255000);
  });

  it("скидка истекла -> base price (авто-истечение, без ручного выключения)", async () => {
    const product = await makeProduct({ price: 100000 });
    await prisma.discount.create({
      data: {
        productId: product.id,
        type: "percent",
        value: 50,
        startsAt: null,
        endsAt: new Date("2020-01-01"),
      },
    });

    const res = await POST(req(checkoutBody([{ productId: product.id, quantity: 1 }])));
    const json = await res.json();
    orderIds.push(json.orderId);

    const order = await getOrderTotal(json.orderId);
    expect(order.items[0].price).toBe(100000);
  });

  it("итоговая цена никогда не отрицательная и не превышает исходную (fixed > price)", async () => {
    const product = await makeProduct({ price: 10000 });
    await prisma.discount.create({
      data: { productId: product.id, type: "fixed", value: 999999, startsAt: null, endsAt: null },
    });

    const res = await POST(req(checkoutBody([{ productId: product.id, quantity: 1 }])));
    const json = await res.json();
    orderIds.push(json.orderId);

    const order = await getOrderTotal(json.orderId);
    expect(order.items[0].price).toBe(0);
    expect(order.items[0].price).toBeGreaterThanOrEqual(0);
  });

  it("несколько товаров с разными скидками в одном заказе — каждый пересчитан независимо", async () => {
    const a = await makeProduct({ price: 100000 });
    const b = await makeProduct({ price: 200000 });
    await prisma.discount.create({
      data: { productId: a.id, type: "percent", value: 10, startsAt: null, endsAt: null },
    });
    // b — без скидки

    const res = await POST(
      req(
        checkoutBody([
          { productId: a.id, quantity: 1 },
          { productId: b.id, quantity: 1 },
        ]),
      ),
    );
    const json = await res.json();
    orderIds.push(json.orderId);

    const order = await getOrderTotal(json.orderId);
    const itemA = order.items.find((i) => i.productId === a.id)!;
    const itemB = order.items.find((i) => i.productId === b.id)!;
    expect(itemA.price).toBe(90000);
    expect(itemB.price).toBe(200000);
    expect(order.totalAmount).toBe(290000);
  });
});
