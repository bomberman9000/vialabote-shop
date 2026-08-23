import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AdminActor } from "../actor";
import { authorizeAdmin } from "../authorize";
import { writeAuditLog } from "../audit";
import { AdminCommandError } from "../errors";
import { buildLifecycleFields, canTransition, isProductStatus, type ProductStatus } from "../product-lifecycle";

// ---- Explicit allowlisted input contracts (никакого arbitrary payload) ----

const createProductSchema = z.object({
  title: z.string().min(2).max(200),
  slug: z
    .string()
    .min(2)
    .max(200)
    .regex(/^[a-z0-9-]+$/, "slug: только латиница, цифры и дефис"),
  description: z.string().max(5000).default(""),
  subtitle: z.string().max(200).optional(),
  price: z.number().int().positive(),
  stock: z.number().int().min(0).optional(),
  categoryId: z.string().min(1),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

const updateProductSchema = z.object({
  productId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  title: z.string().min(2).max(200).optional(),
  subtitle: z.string().max(200).optional(),
  description: z.string().max(5000).optional(),
  activeIngredients: z.string().max(2000).optional(),
  howToUse: z.string().max(2000).optional(),
  volume: z.string().max(50).optional(),
  badge: z.string().max(50).optional(),
  stock: z.number().int().min(0).optional(),
});
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

const productLifecycleSchema = z.object({
  productId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
});

const setPriceSchema = z.object({
  productId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  price: z.number().int().positive(),
});
export type SetPriceInput = z.infer<typeof setPriceSchema>;

const setDiscountSchema = z
  .object({
    productId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    type: z.enum(["percent", "fixed"]),
    value: z.number().int().positive(),
    startsAt: z.date().nullable().optional(),
    endsAt: z.date().nullable().optional(),
  })
  .refine((v) => !v.startsAt || !v.endsAt || v.startsAt <= v.endsAt, {
    message: "startsAt должен быть не позже endsAt — иначе скидка никогда не станет активной",
    path: ["endsAt"],
  });
export type SetDiscountInput = z.infer<typeof setDiscountSchema>;

const removeDiscountSchema = productLifecycleSchema;
const deleteProductSchema = productLifecycleSchema;

// ---- Общий helper: fetch + concurrency check ----

async function loadProductForWrite(productId: string, expectedVersion: number) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) {
    throw new AdminCommandError("NOT_FOUND", "Товар не найден");
  }
  if (product.version !== expectedVersion) {
    throw new AdminCommandError(
      "VERSION_CONFLICT",
      `Товар изменился после формирования команды. Текущая версия: ${product.version}, цена: ${product.price}.`,
      { currentVersion: product.version, currentPrice: product.price },
    );
  }
  return product;
}

/**
 * Единственная точка записи с OCC-проверкой. Prisma `update()` не умеет
 * условный `where: {id, version}` без составного unique-индекса — поэтому
 * `updateMany` (которая допускает произвольный where) + проверка count.
 * count===0 значит версия разошлась МЕЖДУ нашим чтением и этой записью
 * (гонка) — тогда VERSION_CONFLICT, даже если наш предварительный check
 * в loadProductForWrite уже проходил.
 */
async function applyOptimisticUpdate(
  tx: Prisma.TransactionClient,
  productId: string,
  expectedVersion: number,
  data: Prisma.ProductUpdateManyMutationInput,
) {
  const result = await tx.product.updateMany({
    where: { id: productId, version: expectedVersion },
    data: { ...data, version: { increment: 1 } },
  });
  if (result.count === 0) {
    const current = await tx.product.findUnique({ where: { id: productId } });
    throw new AdminCommandError(
      "VERSION_CONFLICT",
      `Товар изменился параллельно во время записи. Текущая версия: ${current?.version}, цена: ${current?.price}.`,
      { currentVersion: current?.version, currentPrice: current?.price },
    );
  }
  const after = await tx.product.findUniqueOrThrow({ where: { id: productId } });
  return after;
}

// ---- Commands ----

export async function createProduct(actor: AdminActor, rawInput: unknown) {
  await authorizeAdmin(actor);
  const input = createProductSchema.parse(rawInput);

  const category = await prisma.category.findUnique({ where: { id: input.categoryId } });
  if (!category) throw new AdminCommandError("NOT_FOUND", "Категория не найдена");

  const existing = await prisma.product.findUnique({ where: { slug: input.slug } });
  if (existing) throw new AdminCommandError("VALIDATION", "Товар с таким slug уже существует");

  const lifecycle = buildLifecycleFields("draft");

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        title: input.title,
        slug: input.slug,
        description: input.description,
        subtitle: input.subtitle,
        price: input.price,
        stock: input.stock ?? 0,
        imageUrl: "/images/placeholder.svg", // до AttachMedia
        categoryId: input.categoryId,
        status: lifecycle.status,
        isActive: lifecycle.isActive,
      },
    });
    await writeAuditLog(tx, actor, {
      action: "CREATE_PRODUCT",
      entityType: "Product",
      entityId: product.id,
      before: null,
      after: product,
    });
    return product;
  });
}

export async function updateProduct(actor: AdminActor, rawInput: unknown) {
  await authorizeAdmin(actor);
  const input = updateProductSchema.parse(rawInput);
  const before = await loadProductForWrite(input.productId, input.expectedVersion);

  const { productId, expectedVersion, ...fields } = input;

  return prisma.$transaction(async (tx) => {
    const after = await applyOptimisticUpdate(tx, productId, expectedVersion, fields);
    await writeAuditLog(tx, actor, {
      action: "UPDATE_PRODUCT",
      entityType: "Product",
      entityId: productId,
      before,
      after,
    });
    return after;
  });
}

async function transitionProduct(actor: AdminActor, rawInput: unknown, targetStatus: ProductStatus, action: string) {
  await authorizeAdmin(actor);
  const input = productLifecycleSchema.parse(rawInput);
  const before = await loadProductForWrite(input.productId, input.expectedVersion);

  if (!isProductStatus(before.status)) {
    throw new AdminCommandError("VALIDATION", `Товар в неизвестном статусе: ${before.status}`);
  }
  if (!canTransition(before.status, targetStatus)) {
    throw new AdminCommandError(
      "INVALID_TRANSITION",
      `Переход ${before.status} → ${targetStatus} не разрешён`,
    );
  }

  const lifecycle = buildLifecycleFields(targetStatus);

  return prisma.$transaction(async (tx) => {
    const after = await applyOptimisticUpdate(tx, input.productId, input.expectedVersion, {
      status: lifecycle.status,
      isActive: lifecycle.isActive,
    });
    await writeAuditLog(tx, actor, {
      action,
      entityType: "Product",
      entityId: input.productId,
      before,
      after,
    });
    return after;
  });
}

export function publishProduct(actor: AdminActor, rawInput: unknown) {
  return transitionProduct(actor, rawInput, "published", "PUBLISH_PRODUCT");
}

export function archiveProduct(actor: AdminActor, rawInput: unknown) {
  return transitionProduct(actor, rawInput, "archived", "ARCHIVE_PRODUCT");
}

export function unpublishToDraft(actor: AdminActor, rawInput: unknown) {
  return transitionProduct(actor, rawInput, "draft", "UNPUBLISH_PRODUCT");
}

export async function setPrice(actor: AdminActor, rawInput: unknown) {
  await authorizeAdmin(actor);
  const input = setPriceSchema.parse(rawInput);
  const before = await loadProductForWrite(input.productId, input.expectedVersion);

  return prisma.$transaction(async (tx) => {
    const after = await applyOptimisticUpdate(tx, input.productId, input.expectedVersion, {
      price: input.price,
    });
    await writeAuditLog(tx, actor, {
      action: "SET_PRICE",
      entityType: "Product",
      entityId: input.productId,
      before: { price: before.price },
      after: { price: after.price },
    });
    return after;
  });
}

export async function setDiscount(actor: AdminActor, rawInput: unknown) {
  await authorizeAdmin(actor);
  const input = setDiscountSchema.parse(rawInput);
  if (input.type === "percent" && (input.value < 1 || input.value > 100)) {
    throw new AdminCommandError("VALIDATION", "Процент скидки должен быть от 1 до 100");
  }
  const before = await loadProductForWrite(input.productId, input.expectedVersion);
  const beforeDiscount = await prisma.discount.findUnique({ where: { productId: input.productId } });

  return prisma.$transaction(async (tx) => {
    const discount = await tx.discount.upsert({
      where: { productId: input.productId },
      create: {
        productId: input.productId,
        type: input.type,
        value: input.value,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
      },
      update: {
        type: input.type,
        value: input.value,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
      },
    });
    await applyOptimisticUpdate(tx, input.productId, input.expectedVersion, {});
    await writeAuditLog(tx, actor, {
      action: "SET_DISCOUNT",
      entityType: "Product",
      entityId: input.productId,
      before: beforeDiscount,
      after: discount,
    });
    return discount;
  });
}

export async function deleteProduct(actor: AdminActor, rawInput: unknown) {
  await authorizeAdmin(actor);
  const input = deleteProductSchema.parse(rawInput);
  const before = await loadProductForWrite(input.productId, input.expectedVersion);

  return prisma.$transaction(async (tx) => {
    // deleteMany (не delete) — только так where может нести OCC-условие по version.
    let result;
    try {
      result = await tx.product.deleteMany({ where: { id: input.productId, version: input.expectedVersion } });
    } catch {
      // FK constraint (OrderItem -> Product) — товар уже фигурирует в заказах.
      // Сырую Prisma-ошибку НЕ прокидываем в details — errors.ts прямо
      // требует "никогда сырой stack trace/Prisma-ошибку" в ответе клиенту.
      throw new AdminCommandError(
        "VALIDATION",
        "Нельзя удалить товар, на который есть заказы — сначала заархивируйте его",
      );
    }
    if (result.count === 0) {
      const current = await tx.product.findUnique({ where: { id: input.productId } });
      if (!current) throw new AdminCommandError("NOT_FOUND", "Товар не найден");
      throw new AdminCommandError(
        "VERSION_CONFLICT",
        `Товар изменился параллельно во время удаления. Текущая версия: ${current.version}.`,
        { currentVersion: current.version },
      );
    }
    await writeAuditLog(tx, actor, {
      action: "DELETE_PRODUCT",
      entityType: "Product",
      entityId: input.productId,
      before,
      after: null,
    });
    return { ok: true };
  });
}

export async function removeDiscount(actor: AdminActor, rawInput: unknown) {
  await authorizeAdmin(actor);
  const input = removeDiscountSchema.parse(rawInput);
  const before = await loadProductForWrite(input.productId, input.expectedVersion);
  const beforeDiscount = await prisma.discount.findUnique({ where: { productId: input.productId } });

  if (!beforeDiscount) {
    throw new AdminCommandError("NOT_FOUND", "У товара нет активной скидки");
  }

  return prisma.$transaction(async (tx) => {
    await tx.discount.delete({ where: { productId: input.productId } });
    await applyOptimisticUpdate(tx, input.productId, input.expectedVersion, {});
    await writeAuditLog(tx, actor, {
      action: "REMOVE_DISCOUNT",
      entityType: "Product",
      entityId: input.productId,
      before: beforeDiscount,
      after: null,
    });
    return { ok: true };
  });
}
