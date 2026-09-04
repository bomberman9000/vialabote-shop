import { describe, it, expect, vi } from "vitest";
import { deriveIsActive } from "./product-lifecycle";

// Regression: на чистом checkout (`migrate deploy` + `db:seed`) витрина
// оставалась пустой. Причина — schema-дефолты Product.status="draft" /
// isActive=false: сид создавал товары без lifecycle-полей, и запрос каталога
// `where: { isActive: true }` не находил ни одного SKU. Тест фиксирует
// инвариант: КАЖДЫЙ create-payload сида публикует товар, и isActive в нём
// derived из status, а не проставлен независимо.

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

describe("prisma/seed.ts — clean-checkout lifecycle", () => {
  it("создаёт все товары опубликованными и видимыми на витрине", async () => {
    await import("../../../prisma/seed");
    await vi.waitFor(() => expect(recorded.productCreates.length).toBeGreaterThan(0));

    for (const create of recorded.productCreates) {
      expect(create.status, `SKU ${String(create.slug)} должен быть published`).toBe("published");
      // isActive не проставляется независимо — только derived из status.
      expect(create.isActive, `SKU ${String(create.slug)} должен быть виден в каталоге`).toBe(
        deriveIsActive("published"),
      );
    }
  });
});
