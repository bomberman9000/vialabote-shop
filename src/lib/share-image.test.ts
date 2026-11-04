import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { productShareImage, SHARE_IMAGE } from "./share-image";

describe("превью ссылок (Open Graph)", () => {
  it("у товара — его JPEG по имени фото; файл реально лежит в public", () => {
    const img = productShareImage("/images/products/packshot/toner-serum-ph55.webp", "Тоник-сыворотка pH 5.5");
    expect(img).toEqual({ url: "/og/products/toner-serum-ph55.jpg", width: 1200, height: 630, alt: "Тоник-сыворотка pH 5.5" });
  });

  it("нет своего превью или фото не из packshot — баннер магазина", () => {
    expect(productShareImage("/images/products/packshot/new-product.webp", "Новинка")).toBe(SHARE_IMAGE);
    expect(productShareImage("/uploads/photo.webp", "Загружено в админке")).toBe(SHARE_IMAGE);
    expect(productShareImage("/images/products/packshot/../../og/vialabote-share.webp", "x")).toBe(SHARE_IMAGE);
  });

  it("баннер и превью каждого товара из packshot — JPEG 1200×630 не больше 300 КБ", () => {
    const pub = path.join(process.cwd(), "public");
    const files = [SHARE_IMAGE.url, ...fs.readdirSync(path.join(pub, "images/products/packshot")).map((f) => `/og/products/${f.replace(/\.webp$/, ".jpg")}`)];
    for (const f of files) {
      const buf = fs.readFileSync(path.join(pub, f));
      expect(buf.subarray(0, 3).toString("hex"), f).toBe("ffd8ff"); // JPEG
      expect(buf.length, f).toBeLessThan(300_000);
      // Размер из маркера SOF0/SOF2: высота и ширина — по 2 байта после 0xFFC0/0xFFC2 + 3.
      let i = 2;
      while (i < buf.length && !(buf[i] === 0xff && (buf[i + 1] === 0xc0 || buf[i + 1] === 0xc2))) i += 2 + buf.readUInt16BE(i + 2);
      expect([buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)], f).toEqual([1200, 630]);
    }
  });
});
