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

// Owner-confirmed цены собственного магазина (2026-10-07), в копейках.
// Цены WB в магазин не переносятся; сид обязан опубликовать все 11 SKU
// именно с этими ценами.
const OWNER_PRICES: Record<string, number> = {
  "serum-8-in-1-white-tea": 51000,
  "inci-retinal-serum": 59000,
  "multi3-anti-acne-serum": 57000,
  "serum-resveratrol-vitamin-c": 63000,
  "hydrophilic-gel-oil": 50000,
  "hydrophilic-balancing-oil": 60000,
  "beard-oil-steblev": 55000,
  "beard-oil-unscented": 59000,
  "beard-oil-bigman": 50000,
  "raspberry-ketone-hair-oil": 48000,
  "rosemary-hair-oil": 45000,
};
// SKU без подтверждённого остатка: сид не выдумывает наличие (stock=0).
const NO_CONFIRMED_STOCK = [
  "hydrophilic-balancing-oil",
  "beard-oil-unscented",
  "beard-oil-bigman",
  "raspberry-ketone-hair-oil",
  "rosemary-hair-oil",
];

describe("prisma/seed.ts — clean-checkout lifecycle", () => {
  it("публикует все SKU с owner-confirmed ценой и не выдумывает остаток", async () => {
    await import("../../../prisma/seed");
    await vi.waitFor(() => expect(recorded.productCreates.length).toBe(11));

    const bySlug = new Map(recorded.productCreates.map((c) => [String(c.slug), c]));
    expect([...bySlug.keys()].sort()).toEqual(Object.keys(OWNER_PRICES).sort());

    for (const [slug, price] of Object.entries(OWNER_PRICES)) {
      const create = bySlug.get(slug)!;
      expect(create.status, `SKU ${slug} должен быть published`).toBe("published");
      // isActive не проставляется независимо — только derived из status.
      expect(create.isActive, `SKU ${slug} должен быть виден в каталоге`).toBe(deriveIsActive("published"));
      expect(create.price, `SKU ${slug} — цена владельца`).toBe(price);
      if (NO_CONFIRMED_STOCK.includes(slug)) expect(create.stock, `SKU ${slug} — остаток не выдуман`).toBe(0);
    }
    // Повторный сид держит цену владельца у существующих строк.
    for (const update of recorded.productUpdates) {
      expect(update.price, String(update.slug)).toBe(OWNER_PRICES[String(update.slug)]);
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
    // Повторный сид не трогает остаток и статус — их задаёт владелец.
    for (const update of recorded.productUpdates) {
      expect(update).not.toHaveProperty("stock");
      expect(update).not.toHaveProperty("status");
      expect(update).not.toHaveProperty("isActive");
    }
  });
});
