import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createProduct,
  updateProduct,
  publishProduct,
  archiveProduct,
  setPrice,
  setDiscount,
  removeDiscount,
  deleteProduct,
} from "./product";
import { AdminCommandError } from "../errors";

// Интеграционные тесты — реальная БД (dev.db), собственные тестовые сущности,
// полная очистка после набора. Не мутирует существующие товары/категории.
let adminUserId: string;
let customerUserId: string;
let categoryId: string;
const createdProductIds: string[] = [];

beforeAll(async () => {
  const category = await prisma.category.create({
    data: { name: "TEST-CommandLayer", slug: `test-command-layer-${Date.now()}` },
  });
  categoryId = category.id;

  const admin = await prisma.user.create({
    data: {
      email: `test-admin-${Date.now()}@example.com`,
      name: "Test Admin",
      passwordHash: "x",
      role: "ADMIN",
    },
  });
  adminUserId = admin.id;

  const customer = await prisma.user.create({
    data: {
      email: `test-customer-${Date.now()}@example.com`,
      name: "Test Customer",
      passwordHash: "x",
      role: "CUSTOMER",
    },
  });
  customerUserId = customer.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: createdProductIds } } });
  await prisma.discount.deleteMany({ where: { productId: { in: createdProductIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.category.delete({ where: { id: categoryId } }).catch(() => {});
  await prisma.user.delete({ where: { id: adminUserId } }).catch(() => {});
  await prisma.user.delete({ where: { id: customerUserId } }).catch(() => {});
});

function uniqueSlug(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("createProduct — authorization", () => {
  it("не-админ не может создать товар", async () => {
    await expect(
      createProduct(
        { userId: customerUserId, source: "WEB_ADMIN" },
        { title: "X", slug: uniqueSlug("x"), price: 1000, categoryId },
      ),
    ).rejects.toThrow(AdminCommandError);
  });

  it("несуществующий userId (подделанный actor) отклоняется — authorize идёт в БД, не доверяет claim", async () => {
    await expect(
      createProduct(
        { userId: "forged-nonexistent-user-id", source: "TELEGRAM" },
        { title: "X", slug: uniqueSlug("x"), price: 1000, categoryId },
      ),
    ).rejects.toThrow(AdminCommandError);
  });
});

describe("createProduct — validation (explicit allowlist, никакого arbitrary payload)", () => {
  it("отклоняет payload без обязательных полей", async () => {
    await expect(
      createProduct({ userId: adminUserId, source: "WEB_ADMIN" }, { title: "X" }),
    ).rejects.toThrow();
  });

  it("отклоняет попытку протащить произвольные лишние поля как business-логику (напр. isActive напрямую)", async () => {
    // Zod .parse() без .passthrough() отбрасывает лишние ключи — но что
    // важнее, isActive/status НЕЛЬЗЯ передать этой командой вообще: их нет
    // в схеме, значит lifecycle всегда создаётся через deriveIsActive("draft").
    const product = await createProduct(
      { userId: adminUserId, source: "WEB_ADMIN" },
      {
        title: "Test Product",
        slug: uniqueSlug("forged"),
        price: 50000,
        categoryId,
        isActive: true, // не в схеме — должно быть проигнорировано
        status: "published", // не в схеме — должно быть проигнорировано
      },
    );
    createdProductIds.push(product.id);
    expect(product.status).toBe("draft");
    expect(product.isActive).toBe(false);
  });

  it("создаёт товар с корректными данными в статусе draft", async () => {
    const product = await createProduct(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { title: "Валидный товар", slug: uniqueSlug("valid"), price: 60000, categoryId },
    );
    createdProductIds.push(product.id);
    expect(product.status).toBe("draft");
    expect(product.isActive).toBe(false);
    expect(product.version).toBe(1);
  });

  it("отклоняет дублирующийся slug", async () => {
    const slug = uniqueSlug("dup");
    const p1 = await createProduct(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { title: "Товар A", slug, price: 1000, categoryId },
    );
    createdProductIds.push(p1.id);
    await expect(
      createProduct(
        { userId: adminUserId, source: "WEB_ADMIN" },
        { title: "Товар B", slug, price: 2000, categoryId },
      ),
    ).rejects.toThrow(AdminCommandError);
  });
});

describe("Product lifecycle — publish/archive", () => {
  it("draft -> published -> archived, isActive синхронно с каждым переходом", async () => {
    const product = await createProduct(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { title: "Lifecycle test", slug: uniqueSlug("lifecycle"), price: 30000, categoryId },
    );
    createdProductIds.push(product.id);

    const published = await publishProduct(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { productId: product.id, expectedVersion: product.version },
    );
    expect(published.status).toBe("published");
    expect(published.isActive).toBe(true);
    expect(published.version).toBe(2);

    const archived = await archiveProduct(
      { userId: adminUserId, source: "TELEGRAM" },
      { productId: product.id, expectedVersion: published.version },
    );
    expect(archived.status).toBe("archived");
    expect(archived.isActive).toBe(false);
  });

  it("устаревший expectedVersion отклоняется (VERSION_CONFLICT), значение не перетирается", async () => {
    const product = await createProduct(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { title: "Conflict test", slug: uniqueSlug("conflict"), price: 40000, categoryId },
    );
    createdProductIds.push(product.id);

    await publishProduct(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { productId: product.id, expectedVersion: 1 },
    );

    // Тот же (устаревший) expectedVersion=1 второй раз — версия уже 2 в БД.
    await expect(
      archiveProduct(
        { userId: adminUserId, source: "WEB_ADMIN" },
        { productId: product.id, expectedVersion: 1 },
      ),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
});

describe("setPrice — server-authoritative, только через команду", () => {
  it("меняет цену и увеличивает version, пишет audit", async () => {
    const product = await createProduct(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { title: "Price test", slug: uniqueSlug("price"), price: 60400, categoryId },
    );
    createdProductIds.push(product.id);

    const updated = await setPrice(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { productId: product.id, expectedVersion: product.version, price: 55000 },
    );
    expect(updated.price).toBe(55000);
    expect(updated.version).toBe(2);

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: product.id, action: "SET_PRICE" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();
    expect(JSON.parse(audit!.before!)).toEqual({ price: 60400 });
    expect(JSON.parse(audit!.after!)).toEqual({ price: 55000 });
  });

  it("отклоняет отрицательную/нулевую цену", async () => {
    const product = await createProduct(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { title: "Bad price test", slug: uniqueSlug("badprice"), price: 10000, categoryId },
    );
    createdProductIds.push(product.id);
    await expect(
      setPrice(
        { userId: adminUserId, source: "WEB_ADMIN" },
        { productId: product.id, expectedVersion: product.version, price: -100 },
      ),
    ).rejects.toThrow();
  });
});

describe("setDiscount / removeDiscount", () => {
  it("устанавливает и снимает скидку, каждое действие в audit log", async () => {
    const product = await createProduct(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { title: "Discount test", slug: uniqueSlug("discount"), price: 100000, categoryId },
    );
    createdProductIds.push(product.id);

    const discount = await setDiscount(
      { userId: adminUserId, source: "TELEGRAM" },
      { productId: product.id, expectedVersion: 1, type: "percent", value: 15, startsAt: null, endsAt: null },
    );
    expect(discount.type).toBe("percent");
    expect(discount.value).toBe(15);

    const afterDiscountProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(afterDiscountProduct.version).toBe(2); // version бампнулась и от discount-команды

    await removeDiscount(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { productId: product.id, expectedVersion: 2 },
    );
    const gone = await prisma.discount.findUnique({ where: { productId: product.id } });
    expect(gone).toBeNull();

    const auditActions = await prisma.auditLog.findMany({
      where: { entityId: product.id, action: { in: ["SET_DISCOUNT", "REMOVE_DISCOUNT"] } },
    });
    expect(auditActions.length).toBe(2);
  });

  it("отклоняет процент вне диапазона 1-100", async () => {
    const product = await createProduct(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { title: "Bad discount test", slug: uniqueSlug("baddiscount"), price: 10000, categoryId },
    );
    createdProductIds.push(product.id);
    await expect(
      setDiscount(
        { userId: adminUserId, source: "WEB_ADMIN" },
        { productId: product.id, expectedVersion: 1, type: "percent", value: 150, startsAt: null, endsAt: null },
      ),
    ).rejects.toThrow(AdminCommandError);
  });
});

describe("updateProduct — content fields only, не price/status/media", () => {
  it("обновляет текстовые поля, не трогая price/status", async () => {
    const product = await createProduct(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { title: "Update test", slug: uniqueSlug("update"), price: 70000, categoryId },
    );
    createdProductIds.push(product.id);

    const updated = await updateProduct(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { productId: product.id, expectedVersion: 1, subtitle: "Новый subtitle", howToUse: "Как использовать" },
    );
    expect(updated.subtitle).toBe("Новый subtitle");
    expect(updated.price).toBe(70000); // не изменилась
    expect(updated.status).toBe("draft"); // не изменился
  });
});

describe("deleteProduct — hard delete через command layer с OCC и audit", () => {
  it("удаляет товар и пишет audit", async () => {
    const product = await createProduct(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { title: "Delete test", slug: uniqueSlug("delete"), price: 30000, categoryId },
    );
    createdProductIds.push(product.id);

    const result = await deleteProduct(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { productId: product.id, expectedVersion: 1 },
    );
    expect(result.ok).toBe(true);

    const gone = await prisma.product.findUnique({ where: { id: product.id } });
    expect(gone).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: product.id, action: "DELETE_PRODUCT" },
    });
    expect(audit).toBeTruthy();
  });

  it("устаревшая expectedVersion -> VERSION_CONFLICT, товар остаётся", async () => {
    const product = await createProduct(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { title: "Delete conflict test", slug: uniqueSlug("delete-conflict"), price: 30000, categoryId },
    );
    createdProductIds.push(product.id);

    await expect(
      deleteProduct({ userId: adminUserId, source: "WEB_ADMIN" }, { productId: product.id, expectedVersion: 999 }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });

    const stillThere = await prisma.product.findUnique({ where: { id: product.id } });
    expect(stillThere).not.toBeNull();
  });

  it("не-админ не может удалить товар", async () => {
    const product = await createProduct(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { title: "Delete auth test", slug: uniqueSlug("delete-auth"), price: 30000, categoryId },
    );
    createdProductIds.push(product.id);

    await expect(
      deleteProduct({ userId: customerUserId, source: "WEB_ADMIN" }, { productId: product.id, expectedVersion: 1 }),
    ).rejects.toThrow(AdminCommandError);

    const stillThere = await prisma.product.findUnique({ where: { id: product.id } });
    expect(stillThere).not.toBeNull();
  });

  it("товар с существующим заказом не удаляется (FK) — понятная ошибка, не удаление", async () => {
    const product = await createProduct(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { title: "Delete with order test", slug: uniqueSlug("delete-order"), price: 30000, categoryId },
    );
    createdProductIds.push(product.id);

    const order = await prisma.order.create({
      data: {
        number: `TEST-DEL-${Date.now()}`,
        userId: customerUserId,
        status: "NEW",
        customerName: "Test Customer",
        customerEmail: "test-delete-order@example.com",
        customerPhone: "+70000000000",
        deliveryCity: "Москва",
        deliveryAddress: "Тестовая, 1",
        totalAmount: 30000,
        items: { create: [{ productId: product.id, title: product.title, price: product.price, quantity: 1 }] },
      },
    });

    await expect(
      deleteProduct({ userId: adminUserId, source: "WEB_ADMIN" }, { productId: product.id, expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    const stillThere = await prisma.product.findUnique({ where: { id: product.id } });
    expect(stillThere).not.toBeNull();

    await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await prisma.order.delete({ where: { id: order.id } });
  });
});
