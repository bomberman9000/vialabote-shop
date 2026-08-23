import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveProductByQuery } from "./entity-resolver";

let categoryId: string;
const productIds: string[] = [];
const suffix = Date.now();

beforeAll(async () => {
  const category = await prisma.category.create({
    data: { name: "TEST-Resolver", slug: `test-resolver-${suffix}` },
  });
  categoryId = category.id;

  const specs = [
    { title: `Multi3 ${suffix}`, slug: `multi3-${suffix}` },
    // Общий уникальный токен (suffix) в начале, чтобы partial-запрос по нему
    // гарантированно не пересекался с реальными товарами каталога.
    { title: `RS${suffix} Retinal Serum`, slug: `retinal-serum-${suffix}` },
    { title: `RS${suffix} Retinal Serum Pro`, slug: `retinal-serum-pro-${suffix}` },
    { title: `Beard Oil ${suffix}`, slug: `beard-oil-${suffix}` },
  ];
  for (const s of specs) {
    const p = await prisma.product.create({
      data: {
        title: s.title,
        slug: s.slug,
        description: "",
        price: 10000,
        imageUrl: "/images/placeholder.svg",
        categoryId,
      },
    });
    productIds.push(p.id);
  }
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.category.delete({ where: { id: categoryId } });
});

describe("resolveProductByQuery", () => {
  it("точный slug -> found", async () => {
    const r = await resolveProductByQuery(`multi3-${suffix}`);
    expect(r.status).toBe("found");
    if (r.status === "found") expect(r.product.slug).toBe(`multi3-${suffix}`);
  });

  it("точный title (без учёта регистра) -> found", async () => {
    const r = await resolveProductByQuery(`MULTI3 ${suffix}`);
    expect(r.status).toBe("found");
    if (r.status === "found") expect(r.product.title).toBe(`Multi3 ${suffix}`);
  });

  it("однозначное частичное совпадение -> found", async () => {
    // Суффикс делает запрос заведомо уникальным среди реальных товаров в БД.
    const r = await resolveProductByQuery(`beard oil ${suffix}`);
    expect(r.status).toBe("found");
    if (r.status === "found") expect(r.product.slug).toBe(`beard-oil-${suffix}`);
  });

  it("неоднозначное частичное совпадение ('RS<suffix> Retinal Serum' содержится в двух) -> ambiguous, НЕ угадывает", async () => {
    // Запрос — подстрока обоих товаров и точное совпадение ни одного.
    const r = await resolveProductByQuery(`rs${suffix} retinal ser`);
    expect(r.status).toBe("ambiguous");
    if (r.status === "ambiguous") {
      expect(r.candidates).toHaveLength(2);
      const titles = r.candidates.map((c) => c.title).sort();
      expect(titles).toEqual([`RS${suffix} Retinal Serum`, `RS${suffix} Retinal Serum Pro`].sort());
    }
  });

  it("несуществующий товар -> not_found", async () => {
    const r = await resolveProductByQuery(`does-not-exist-${suffix}-xyz`);
    expect(r.status).toBe("not_found");
  });

  it("пустая строка -> not_found (не бросает исключение)", async () => {
    const r = await resolveProductByQuery("   ");
    expect(r.status).toBe("not_found");
  });

  it("точный title-match предпочитается частичному, когда есть подстрочные совпадения у других товаров", async () => {
    // Запрос точно совпадает с одним товаром, хотя является подстрокой и
    // другого ("...Serum Pro") — точное совпадение должно победить, не
    // доходя до неоднозначного partial-этапа.
    const r = await resolveProductByQuery(`RS${suffix} Retinal Serum`);
    expect(r.status).toBe("found");
    if (r.status === "found") expect(r.product.slug).toBe(`retinal-serum-${suffix}`);
  });
});
