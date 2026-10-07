import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { deriveIsActive } from "./product-lifecycle";

// Regression: на чистом checkout (`migrate deploy` + `db:seed`) витрина
// оставалась пустой. Причина — schema-дефолты Product.status="draft" /
// isActive=false: сид создавал товары без lifecycle-полей, и запрос каталога
// `where: { isActive: true }` не находил ни одного SKU. Тест фиксирует
// инвариант: каждый товар витрины публикуется сидом, черновики без цены — нет,
// и isActive везде derived из status, а не проставлен независимо.

const recorded = vi.hoisted(() => ({
  productCreates: [] as Record<string, unknown>[],
  productUpdates: [] as Record<string, unknown>[],
  categories: [] as { slug: string; name: string }[],
}));

vi.mock("@prisma/client", () => {
  const id = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2)}`;
  return {
    PrismaClient: class {
      category = {
        upsert: async (a: { create: { slug: string; name: string } }) => {
          recorded.categories.push(a.create);
          return { id: `cat-${a.create.slug}` };
        },
      };
      product = {
        upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
          recorded.productCreates.push(args.create);
          recorded.productUpdates.push({ slug: args.create.slug, ...args.update });
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

  // Сверка с каталогом бренда vialabote.ru/products (2026-10-07): 11 SKU,
  // категория и объём как на сайте бренда, packshot существует в public/.
  it("каталог совпадает с линейкой бренда: категория, объём, фото, контент", async () => {
    await import("../../../prisma/seed");
    await vi.waitFor(() => expect(recorded.productCreates.length).toBe(11));
    const expected: Record<string, { category: string; volume: string }> = {
      "serum-8-in-1-white-tea": { category: "syvorotki", volume: "50 мл" },
      "inci-retinal-serum": { category: "syvorotki", volume: "50 мл" },
      "multi3-anti-acne-serum": { category: "syvorotki", volume: "50 мл" },
      "serum-resveratrol-vitamin-c": { category: "syvorotki", volume: "50 мл" },
      "hydrophilic-gel-oil": { category: "ochishchenie", volume: "150 мл" },
      "hydrophilic-balancing-oil": { category: "ochishchenie", volume: "150 мл" },
      "beard-oil-steblev": { category: "dlya-muzhchin", volume: "50 мл" },
      "beard-oil-unscented": { category: "dlya-muzhchin", volume: "50 мл" },
      "beard-oil-bigman": { category: "dlya-muzhchin", volume: "50 мл" },
      "raspberry-ketone-hair-oil": { category: "uhod-za-volosami", volume: "50 мл" },
      "rosemary-hair-oil": { category: "uhod-za-volosami", volume: "50 мл" },
    };
    expect(new Map(recorded.categories.map((c) => [c.slug, c.name]))).toEqual(
      new Map([
        ["syvorotki", "Сыворотки"],
        ["ochishchenie", "Очищение"],
        ["dlya-muzhchin", "Для бороды"],
        ["uhod-za-volosami", "Для волос"],
      ]),
    );
    for (const create of recorded.productCreates) {
      const slug = String(create.slug);
      expect(create.categoryId, slug).toBe(`cat-${expected[slug].category}`);
      expect(create.volume, slug).toBe(expected[slug].volume);
      expect(String(create.title).length, slug).toBeGreaterThan(0);
      expect(String(create.subtitle).length, slug).toBeGreaterThan(0);
      expect(String(create.description).length, slug).toBeGreaterThan(0);
      const image = String(create.imageUrl);
      expect(image, slug).toMatch(/^\/images\/products\/packshot\/[a-z0-9-]+\.webp$/);
      expect(fs.existsSync(path.join(process.cwd(), "public", image)), image).toBe(true);
    }
    // Повторный сид обновляет контент у всех SKU, но цену/остаток/статус
    // черновиков не трогает — их задаёт владелец.
    for (const update of recorded.productUpdates.filter((u) => BRAND_DRAFT_SKUS.includes(String(u.slug)))) {
      expect(update).not.toHaveProperty("price");
      expect(update).not.toHaveProperty("stock");
      expect(update).not.toHaveProperty("status");
      expect(update).not.toHaveProperty("isActive");
    }
  });
});
