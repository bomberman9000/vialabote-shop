// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { breadcrumbJsonLd, jsonLdHtml, productJsonLd, storeJsonLd } from "./seo";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findMany: vi.fn(async () => [
        { slug: "toner-serum-ph55", updatedAt: new Date("2026-10-20T10:00:00Z") },
        { slug: "rosemary-hair-oil", updatedAt: new Date("2026-11-01T10:00:00Z") },
      ]),
    },
  },
}));

const base = { slug: "toner-serum-ph55", title: "Тоник pH 5.5", description: "Описание", subtitle: "Для жирной кожи", imageUrl: "/images/p.webp", stock: 5, price: 55000 };

describe("JSON-LD товара", () => {
  it("цена в рублях, валюта RUB, наличие, бренд, абсолютные адреса", () => {
    const d = productJsonLd({ ...base, images: ["/media/2.webp"], categoryName: "Тоники" });
    expect(d).toMatchObject({
      "@type": "Product",
      name: "Тоник pH 5.5",
      description: "Для жирной кожи",
      image: ["https://shop.vialabote.ru/images/p.webp", "https://shop.vialabote.ru/media/2.webp"],
      brand: { name: "VIA LABOTE" },
      category: "Тоники",
      offers: {
        price: "550.00",
        priceCurrency: "RUB",
        availability: "https://schema.org/InStock",
        url: "https://shop.vialabote.ru/product/toner-serum-ph55",
      },
    });
  });
  it("нет на складе -> OutOfStock; без подзаголовка — описание", () => {
    const d = productJsonLd({ ...base, stock: 0, subtitle: null });
    expect(d.offers.availability).toBe("https://schema.org/OutOfStock");
    expect(d.description).toBe("Описание");
  });
  it("хлебные крошки по порядку с абсолютными адресами; магазин — Organization + WebSite", () => {
    const b = breadcrumbJsonLd([{ name: "Главная", path: "/" }, { name: "Каталог", path: "/catalog" }]);
    expect(b.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Главная", item: "https://shop.vialabote.ru/" },
      { "@type": "ListItem", position: 2, name: "Каталог", item: "https://shop.vialabote.ru/catalog" },
    ]);
    expect(storeJsonLd().map((x) => x["@type"])).toEqual(["Organization", "WebSite"]);
  });
  it("текст из админки не может закрыть тег script", () => {
    const html = jsonLdHtml(productJsonLd({ ...base, title: 'Крем</script><script>alert(1)</script>' }));
    expect(html).not.toContain("</script>");
    expect(JSON.parse(html).name).toBe('Крем</script><script>alert(1)</script>');
  });
});

describe("robots.txt и sitemap.xml", () => {
  it("robots: служебные разделы закрыты, ссылка на sitemap", async () => {
    const r = (await import("@/app/robots")).default();
    expect(r.rules).toEqual([{ userAgent: "*", allow: "/", disallow: ["/account", "/admin", "/api/", "/cart", "/checkout", "/ozon-oauth"] }]);
    expect(r.sitemap).toBe("https://shop.vialabote.ru/sitemap.xml");
  });
  it("sitemap: главная, каталог, каждый опубликованный товар со своей датой, правовые страницы", async () => {
    const { prisma } = await import("@/lib/prisma");
    const s = await (await import("@/app/sitemap")).default();
    expect(s.map((e) => e.url)).toEqual([
      "https://shop.vialabote.ru",
      "https://shop.vialabote.ru/catalog",
      "https://shop.vialabote.ru/product/toner-serum-ph55",
      "https://shop.vialabote.ru/product/rosemary-hair-oil",
      "https://shop.vialabote.ru/returns",
      "https://shop.vialabote.ru/offer",
      "https://shop.vialabote.ru/privacy",
    ]);
    expect(s[0].lastModified).toEqual(new Date("2026-11-01T10:00:00Z"));
    expect(s[2].lastModified).toEqual(new Date("2026-10-20T10:00:00Z"));
    expect(vi.mocked(prisma.product.findMany).mock.calls[0][0]).toMatchObject({ where: { status: "published", isActive: true } });
  });
});
