import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { prepareCommand, executeConfirmation, declineConfirmation } from "./dispatch-command";

// Мок next-auth только для теста ниже, который вызывает POST /api/orders
// напрямую (getServerSession читает next/headers — недоступно вне реального
// Next.js request-scope).
vi.mock("next-auth", () => ({ getServerSession: vi.fn().mockResolvedValue(null) }));
const { POST: postOrder } = await import("@/app/api/orders/route");

const suffix = Date.now();
const ADMIN_TG_ID = `admin-tg-${suffix}`;
const NON_ADMIN_TG_ID = `customer-tg-${suffix}`;
const UNBOUND_TG_ID = `unbound-tg-${suffix}`;

let categoryId: string;
let adminUserId: string;
let customerUserId: string;
const productIds: string[] = [];

async function makeProduct(title: string, slug: string) {
  const p = await prisma.product.create({
    data: {
      title,
      slug,
      description: "",
      price: 5000,
      imageUrl: "/images/placeholder.svg",
      categoryId,
    },
  });
  productIds.push(p.id);
  return p;
}

beforeAll(async () => {
  const category = await prisma.category.create({
    data: { name: "TEST-Dispatch", slug: `test-dispatch-${suffix}` },
  });
  categoryId = category.id;

  const admin = await prisma.user.create({
    data: {
      email: `test-dispatch-admin-${suffix}@example.com`,
      passwordHash: "x",
      role: "ADMIN",
      telegramUserId: ADMIN_TG_ID,
    },
  });
  adminUserId = admin.id;

  const customer = await prisma.user.create({
    data: {
      email: `test-dispatch-customer-${suffix}@example.com`,
      passwordHash: "x",
      role: "CUSTOMER",
      telegramUserId: NON_ADMIN_TG_ID,
    },
  });
  customerUserId = customer.id;
});

afterEach(async () => {
  await prisma.pendingConfirmation.deleteMany({ where: { actorTelegramUserId: ADMIN_TG_ID } });
});

afterAll(async () => {
  await prisma.discount.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.auditLog.deleteMany({ where: { actorId: adminUserId } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.category.delete({ where: { id: categoryId } });
  await prisma.user.delete({ where: { id: adminUserId } });
  await prisma.user.delete({ where: { id: customerUserId } });
});

describe("prepareCommand — авторизация", () => {
  it("непривязанный telegram id -> not_authorized", async () => {
    const r = await prepareCommand(UNBOUND_TG_ID, "цена X 100");
    expect(r.kind).toBe("not_authorized");
  });

  it("привязанный, но не-admin -> not_authorized", async () => {
    const r = await prepareCommand(NON_ADMIN_TG_ID, "цена X 100");
    expect(r.kind).toBe("not_authorized");
  });
});

describe("prepareCommand — парсинг", () => {
  it("нераспознанный текст -> unknown_command", async () => {
    const r = await prepareCommand(ADMIN_TG_ID, "привет как дела");
    expect(r.kind).toBe("unknown_command");
  });

  it("баннер -> unsupported (честно, не притворяется)", async () => {
    const r = await prepareCommand(ADMIN_TG_ID, "баннер главная до 30.08");
    expect(r.kind).toBe("unsupported");
  });
});

describe("prepareCommand — resolve сущности", () => {
  it("товар не найден -> entity_not_found", async () => {
    const r = await prepareCommand(ADMIN_TG_ID, `цена does-not-exist-${suffix} 100`);
    expect(r).toEqual({ kind: "entity_not_found", query: `does-not-exist-${suffix}` });
  });

  it("неоднозначный товар -> entity_ambiguous, не угадывает", async () => {
    await makeProduct(`Dup ${suffix} A`, `dup-a-${suffix}`);
    await makeProduct(`Dup ${suffix} B`, `dup-b-${suffix}`);
    const r = await prepareCommand(ADMIN_TG_ID, `цена Dup ${suffix} 100`);
    expect(r.kind).toBe("entity_ambiguous");
    if (r.kind === "entity_ambiguous") expect(r.candidates.length).toBeGreaterThanOrEqual(2);
  });
});

describe("prepareCommand — LIST_PRODUCTS_MISSING_INCI (read-only, без confirmation)", () => {
  it("не создаёт PendingConfirmation", async () => {
    const before = await prisma.pendingConfirmation.count({ where: { actorTelegramUserId: ADMIN_TG_ID } });
    const r = await prepareCommand(ADMIN_TG_ID, "показать товары без INCI");
    expect(r.kind).toBe("immediate_result");
    const after = await prisma.pendingConfirmation.count({ where: { actorTelegramUserId: ADMIN_TG_ID } });
    expect(after).toBe(before);
  });
});

describe("SET_PRICE — полный цикл prepare -> confirm -> execute", () => {
  it("создаёт confirmation, затем исполняет и меняет цену", async () => {
    const product = await makeProduct(`PriceTarget ${suffix}`, `price-target-${suffix}`);

    const prepared = await prepareCommand(ADMIN_TG_ID, `цена PriceTarget ${suffix} 7777`);
    expect(prepared.kind).toBe("confirmation_required");
    if (prepared.kind !== "confirmation_required") return;

    const outcome = await executeConfirmation(ADMIN_TG_ID, prepared.confirmationId);
    expect(outcome.ok).toBe(true);

    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    // Оператор ввёл "7777" рублей — Product.price хранится в копейках.
    expect(after.price).toBe(777700);
    expect(after.version).toBe(product.version + 1);
  });

  it("чужой telegram id не может подтвердить (не мутирует)", async () => {
    const product = await makeProduct(`PriceTarget2 ${suffix}`, `price-target-2-${suffix}`);
    const prepared = await prepareCommand(ADMIN_TG_ID, `цена PriceTarget2 ${suffix} 8888`);
    if (prepared.kind !== "confirmation_required") throw new Error("expected confirmation_required");

    const outcome = await executeConfirmation(NON_ADMIN_TG_ID, prepared.confirmationId);
    expect(outcome.ok).toBe(false);

    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.price).toBe(product.price); // не изменилась
  });

  it("повторное исполнение (replay) не проходит дважды", async () => {
    const product = await makeProduct(`PriceTarget3 ${suffix}`, `price-target-3-${suffix}`);
    const prepared = await prepareCommand(ADMIN_TG_ID, `цена PriceTarget3 ${suffix} 9999`);
    if (prepared.kind !== "confirmation_required") throw new Error("expected confirmation_required");

    const first = await executeConfirmation(ADMIN_TG_ID, prepared.confirmationId);
    expect(first.ok).toBe(true);
    const second = await executeConfirmation(ADMIN_TG_ID, prepared.confirmationId);
    expect(second.ok).toBe(false);

    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.version).toBe(product.version + 1); // выполнилось ровно один раз
  });

  it("устаревшая версия сущности отклоняется как VERSION_CONFLICT, а не тихо перезаписывает", async () => {
    const product = await makeProduct(`PriceTarget4 ${suffix}`, `price-target-4-${suffix}`);
    const prepared = await prepareCommand(ADMIN_TG_ID, `цена PriceTarget4 ${suffix} 1111`);
    if (prepared.kind !== "confirmation_required") throw new Error("expected confirmation_required");

    // Товар меняется параллельно (напр. через Web Admin) ДО подтверждения.
    await prisma.product.update({ where: { id: product.id }, data: { price: 6000, version: { increment: 1 } } });

    const outcome = await executeConfirmation(ADMIN_TG_ID, prepared.confirmationId);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/изменился/);

    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.price).toBe(6000); // осталась параллельная запись, Telegram-команда не перезаписала
  });

  it("declineConfirmation отменяет — исполнение после отмены невозможно", async () => {
    const product = await makeProduct(`PriceTarget5 ${suffix}`, `price-target-5-${suffix}`);
    const prepared = await prepareCommand(ADMIN_TG_ID, `цена PriceTarget5 ${suffix} 2222`);
    if (prepared.kind !== "confirmation_required") throw new Error("expected confirmation_required");

    await declineConfirmation(ADMIN_TG_ID, prepared.confirmationId);
    const outcome = await executeConfirmation(ADMIN_TG_ID, prepared.confirmationId);
    expect(outcome.ok).toBe(false);

    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.price).toBe(product.price);
  });
});

describe("SET_DISCOUNT — сериализация Date через PendingConfirmation.payload", () => {
  it("создаёт Discount с датой, восстановленной из ISO-строки", async () => {
    const product = await makeProduct(`DiscTarget ${suffix}`, `disc-target-${suffix}`);
    const prepared = await prepareCommand(ADMIN_TG_ID, `скидка DiscTarget ${suffix} 20% до 25.12`);
    expect(prepared.kind).toBe("confirmation_required");
    if (prepared.kind !== "confirmation_required") return;

    const outcome = await executeConfirmation(ADMIN_TG_ID, prepared.confirmationId);
    expect(outcome.ok).toBe(true);

    const discount = await prisma.discount.findUniqueOrThrow({ where: { productId: product.id } });
    expect(discount.type).toBe("percent");
    expect(discount.value).toBe(20);
    expect(discount.endsAt).not.toBeNull();
    expect(discount.endsAt!.getUTCMonth()).toBe(11); // декабрь
    expect(discount.endsAt!.getUTCDate()).toBe(25);
  });
});

describe("PUBLISH_PRODUCT / ARCHIVE_PRODUCT — полный цикл", () => {
  it("archiveProduct через Telegram-подтверждение", async () => {
    const product = await prisma.product.create({
      data: {
        title: `ArchiveTarget ${suffix}`,
        slug: `archive-target-${suffix}`,
        description: "",
        price: 5000,
        imageUrl: "/images/placeholder.svg",
        categoryId,
        status: "published",
        isActive: true,
      },
    });
    productIds.push(product.id);

    const prepared = await prepareCommand(ADMIN_TG_ID, `скрыть ArchiveTarget ${suffix}`);
    if (prepared.kind !== "confirmation_required") throw new Error("expected confirmation_required");

    const outcome = await executeConfirmation(ADMIN_TG_ID, prepared.confirmationId);
    expect(outcome.ok).toBe(true);

    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.status).toBe("archived");
    expect(after.isActive).toBe(false);

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: product.id, action: "ARCHIVE_PRODUCT" },
    });
    expect(audit).toBeTruthy();
    expect(audit!.source).toBe("TELEGRAM");
  });
});

describe("Telegram preview vs checkout — единая effectivePrice()", () => {
  it("цена в preview SET_DISCOUNT совпадает с ценой, которую реально спишет /api/orders после подтверждения", async () => {
    const product = await makeProduct(`PreviewParity ${suffix}`, `preview-parity-${suffix}`);

    const prepared = await prepareCommand(ADMIN_TG_ID, `скидка PreviewParity ${suffix} 30%`);
    if (prepared.kind !== "confirmation_required") throw new Error("expected confirmation_required");

    // Preview показывает "цена станет ...", отформатированную formatPrice() —
    // 30% от 5000 копеек = 3500 копеек = 35 ₽.
    expect(prepared.previewText).toMatch(/35\s*₽/);

    const outcome = await executeConfirmation(ADMIN_TG_ID, prepared.confirmationId);
    expect(outcome.ok).toBe(true);

    const orderReq = new Request("http://localhost/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customerName: "Тест Тестов",
        customerEmail: "parity@example.com",
        customerPhone: "+70000000000",
        deliveryCity: "Москва",
        deliveryAddress: "Тестовая, 1",
        items: [{ productId: product.id, quantity: 1 }],
      }),
    });
    const res = await postOrder(orderReq);
    const json = await res.json();

    const order = await prisma.order.findUniqueOrThrow({ where: { id: json.orderId }, include: { items: true } });
    // Ровно та же цена, что показал Telegram-preview ДО подтверждения: 3500 коп.
    expect(order.items[0].price).toBe(3500);

    await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await prisma.order.delete({ where: { id: order.id } });
  });
});
