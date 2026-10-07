import { describe, it, expect, vi } from "vitest";
import { deriveIsActive } from "./product-lifecycle";

// Regression: на чистом checkout (`migrate deploy` + `db:seed`) витрина
// оставалась пустой. Причина — schema-дефолты Product.status="draft" /
// isActive=false: сид создавал товары без lifecycle-полей, и запрос каталога
// `where: { isActive: true }` не находил ни одного SKU. Тест фиксирует
// инвариант: каждый товар витрины публикуется сидом, черновики без цены — нет,
// и isActive везде derived из status, а не проставлен независимо.

const recorded = vi.hoisted(() => ({ productCreates: [] as Record<string, unknown>[] }));

vi.mock("@prisma/client", () => {
  const id = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2)}`;
  return {
    PrismaClient: class {
      category = { upsert: async () => ({ id: id("cat") }) };
      product = {
        upsert: async (args: { create: Record<string, unknown> }) => {
          recorded.productCreates.push(args.create);
          return { id: id("prod") };
        },
        findUnique: async () => ({ id: id("prod") }),
        update: async () => ({}),
      };
      concern = { upsert: async (a: { create: { slug: string } }) => ({ id: a.create.slug }) };
      skinType = { upsert: async (a: { create: { slug: string } }) => ({ id: a.create.slug }) };
      productConcern = { deleteMany: async () => ({}), create: async () => ({}) };
      productSkinType = { deleteMany: async () => ({}), create: async () => ({}) };
      user = { upsert: async () => ({}) };
      $disconnect = async () => {};
    },
  };
});

// SKU, которые сид обязан опубликовать (витрина магазина), и SKU линейки
// бренда, перенесённые черновиками без утверждённой цены (price=0) — они не
// должны попадать на витрину, пока владелец не задаст цену и не опубликует.
const STOREFRONT_SKUS = [
  "serum-8-in-1-white-tea",
  "serum-resveratrol-vitamin-c",
  "inci-retinal-serum",
  "multi3-anti-acne-serum",
  "hydrophilic-gel-oil",
  "beard-oil-steblev",
];
const BRAND_DRAFT_SKUS = [
  "hydrophilic-balancing-oil",
  "beard-oil-unscented",
  "beard-oil-bigman",
  "raspberry-ketone-hair-oil",
  "rosemary-hair-oil",
];

describe("prisma/seed.ts — clean-checkout lifecycle", () => {
  it("публикует товары витрины и создаёт SKU без цены скрытыми черновиками", async () => {
    await import("../../../prisma/seed");
    const total = STOREFRONT_SKUS.length + BRAND_DRAFT_SKUS.length;
    await vi.waitFor(() => expect(recorded.productCreates.length).toBe(total));

    const bySlug = new Map(recorded.productCreates.map((c) => [String(c.slug), c]));
    expect([...bySlug.keys()].sort()).toEqual([...STOREFRONT_SKUS, ...BRAND_DRAFT_SKUS].sort());

    for (const slug of STOREFRONT_SKUS) {
      const create = bySlug.get(slug)!;
      expect(create.status, `SKU ${slug} должен быть published`).toBe("published");
      // isActive не проставляется независимо — только derived из status.
      expect(create.isActive, `SKU ${slug} должен быть виден в каталоге`).toBe(deriveIsActive("published"));
      expect(create.price as number, `SKU ${slug} должен иметь цену`).toBeGreaterThan(0);
    }

    for (const slug of BRAND_DRAFT_SKUS) {
      const create = bySlug.get(slug)!;
      expect(create.status, `SKU ${slug} должен быть draft`).toBe("draft");
      expect(create.isActive, `SKU ${slug} не должен быть виден`).toBe(deriveIsActive("draft"));
      expect(create.price, `SKU ${slug} — цена не выдумана`).toBe(0);
    }
  });
});
