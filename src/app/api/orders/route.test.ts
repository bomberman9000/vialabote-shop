import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { LEGAL_VERSION } from "@/lib/legal";

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

async function makeProduct(overrides: {
  price: number;
  oldPrice?: number | null;
  title?: string;
  status?: string;
  isActive?: boolean;
  stock?: number;
}) {
  const p = await prisma.product.create({
    data: {
      title: overrides.title ?? `OrderTest ${suffix}-${productIds.length}`,
      slug: `order-test-${suffix}-${productIds.length}`,
      description: "",
      price: overrides.price,
      oldPrice: overrides.oldPrice ?? null,
      imageUrl: "/images/placeholder.svg",
      status: overrides.status ?? "published",
      isActive: overrides.isActive ?? true,
      stock: overrides.stock ?? 100,
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
    offerAccepted: true,
    pdnConsent: true,
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

describe("POST /api/orders — согласия по 152-ФЗ и оферте", () => {
  it("без подтверждения оферты -> 400, заказ не создаётся", async () => {
    const product = await makeProduct({ price: 100000 });
    const res = await POST(
      req(checkoutBody([{ productId: product.id, quantity: 1 }], { offerAccepted: undefined })),
    );
    expect(res.status).toBe(400);
  });

  it("согласие на ПДн и рекламу не обязательны: заказ создаётся, согласий нет", async () => {
    const product = await makeProduct({ price: 100000 });
    const res = await POST(req(checkoutBody([{ productId: product.id, quantity: 1 }], { pdnConsent: undefined })));
    expect(res.status).toBe(200);
    const json = await res.json();
    orderIds.push(json.orderId);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: json.orderId } });
    expect(order.offerAcceptedAt).toBeTruthy();
    expect(order.pdnConsentAt).toBeNull();
    expect(order.adsConsentAt).toBeNull();
    expect(order.legalVersion).toBe(LEGAL_VERSION);
    expect(order.consentSource).toBe("WEB_CHECKOUT");
  });

  it("явные согласия сохраняются отдельно с временем, версией и источником", async () => {
    const product = await makeProduct({ price: 100000 });
    const res = await POST(
      req(checkoutBody([{ productId: product.id, quantity: 1 }], { pdnConsent: true, adsConsent: true })),
    );
    const json = await res.json();
    orderIds.push(json.orderId);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: json.orderId } });
    expect(order.pdnConsentAt).toBeTruthy();
    expect(order.adsConsentAt).toBeTruthy();
  });
});

describe("POST /api/orders — продаётся только доступное", () => {
  it.each([
    ["черновик", { status: "draft", isActive: false }],
    ["архивный", { status: "archived", isActive: false }],
    ["неактивный", { isActive: false }],
    ["нулевая цена", { price: 0 }],
  ])("товар «%s» -> 400", async (_n, o) => {
    const product = await makeProduct({ price: 100000, ...o });
    const res = await POST(req(checkoutBody([{ productId: product.id, quantity: 1 }])));
    expect(res.status).toBe(400);
  });

  it("stock 0 -> 409, заказ не создаётся", async () => {
    const product = await makeProduct({ price: 100000, stock: 0 });
    const res = await POST(req(checkoutBody([{ productId: product.id, quantity: 1 }])));
    expect(res.status).toBe(409);
    expect(await prisma.order.count({ where: { items: { some: { productId: product.id } } } })).toBe(0);
  });

  it("количество больше остатка -> 409", async () => {
    const product = await makeProduct({ price: 100000, stock: 2 });
    const res = await POST(req(checkoutBody([{ productId: product.id, quantity: 3 }])));
    expect(res.status).toBe(409);
  });

  it("дубли одного SKU складываются и не обходят лимит остатка", async () => {
    const product = await makeProduct({ price: 100000, stock: 2 });
    const res = await POST(
      req(checkoutBody([{ productId: product.id, quantity: 2 }, { productId: product.id, quantity: 2 }])),
    );
    expect(res.status).toBe(409);
  });

  it("дубли в пределах остатка -> одна позиция с суммарным количеством", async () => {
    const product = await makeProduct({ price: 100000, stock: 5 });
    const res = await POST(
      req(checkoutBody([{ productId: product.id, quantity: 1 }, { productId: product.id, quantity: 2 }])),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    orderIds.push(json.orderId);
    const order = await getOrderTotal(json.orderId);
    expect(order.items).toHaveLength(1);
    expect(order.items[0].quantity).toBe(3);
    expect(order.totalAmount).toBe(300000);
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

  it("скидка больше цены не уводит цену в минус: итог 0 -> заказ отклоняется, не создаётся", async () => {
    const product = await makeProduct({ price: 10000 });
    await prisma.discount.create({
      data: { productId: product.id, type: "fixed", value: 999999, startsAt: null, endsAt: null },
    });

    const res = await POST(req(checkoutBody([{ productId: product.id, quantity: 1 }])));
    expect(res.status).toBe(400);
    expect(await prisma.order.count({ where: { items: { some: { productId: product.id } } } })).toBe(0);
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

describe("POST /api/orders — склад и эквайринг Точки", () => {
  it("заказ резервирует остаток и пишет журнал; две покупки последней единицы — одна проходит", async () => {
    const product = await makeProduct({ price: 100000, stock: 1 });
    const [a, b] = await Promise.all([
      POST(req(checkoutBody([{ productId: product.id, quantity: 1 }], { offerAccepted: true }))),
      POST(req(checkoutBody([{ productId: product.id, quantity: 1 }], { offerAccepted: true }))),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    for (const r of [a, b]) if (r.status === 200) orderIds.push((await r.json()).orderId);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(0);
  });

  it("с настроенной Точкой: AWAITING_PAYMENT, резерв, ссылка сохранена, покупателя ведём на страницу с таймером", async () => {
    vi.stubEnv("TOCHKA_API_TOKEN", "t");
    vi.stubEnv("TOCHKA_CUSTOMER_CODE", "300000092");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => new Response(JSON.stringify({ Data: { operationId: "op-x", paymentLink: "https://pay.example/x" } }), { status: 200 })),
    );
    const product = await makeProduct({ price: 100000, stock: 3 });
    const res = await POST(req(checkoutBody([{ productId: product.id, quantity: 2 }], { offerAccepted: true })));
    const json = await res.json();
    orderIds.push(json.orderId);
    expect(json.payPage).toBe(`/checkout/pay/${json.orderNumber}`);
    expect(json.paymentUrl).toBeNull(); // ссылку банка отдаёт только страница с таймером, пока не вышли 10 минут
    const order = await prisma.order.findUniqueOrThrow({ where: { id: json.orderId } });
    expect(order).toMatchObject({ status: "AWAITING_PAYMENT", paymentId: "op-x", paymentUrl: "https://pay.example/x", totalAmount: 200000 });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(1);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("банк недоступен: заказ отменён, резерв возвращён, paymentError", async () => {
    vi.stubEnv("TOCHKA_API_TOKEN", "t");
    vi.stubEnv("TOCHKA_CUSTOMER_CODE", "300000092");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("unavailable", { status: 503 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const product = await makeProduct({ price: 100000, stock: 3 });
    const res = await POST(req(checkoutBody([{ productId: product.id, quantity: 2 }], { offerAccepted: true })));
    const json = await res.json();
    orderIds.push(json.orderId);
    expect(json.paymentError).toBe(true);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: json.orderId } })).status).toBe("CANCELLED");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(3);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});
