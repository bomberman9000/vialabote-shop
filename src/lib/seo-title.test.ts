import { describe, expect, it } from "vitest";

import { productSeoTitle } from "./seo";

describe("productSeoTitle", () => {
  it("оставляет короткое название как есть", () => {
    expect(productSeoTitle({ slug: "maslo-dlya-borody", title: "Масло для бороды" })).toBe(
      "Масло для бороды — Via Labote",
    );
  });

  it("для длинного названия оставляет бренд и режет по границе слова", () => {
    const title = productSeoTitle({
      slug: "long-product",
      title: "Увлажняющая сыворотка для лица с гиалуроновой кислотой 8 в 1",
    });
    expect(title.length).toBeLessThanOrEqual(70);
    expect(title.endsWith(" — Via Labote")).toBe(true);
    expect(title).not.toMatch(/\s{2,}/);
    expect(title.trim()).toBe(title);
  });

  it("ручной вариант важнее автоматической обрезки и сохраняет признак товара", () => {
    const title = productSeoTitle({
      slug: "serum-8-in-1-white-tea",
      title: "Увлажняющая сыворотка для лица с гиалуроновой кислотой 8 в 1",
    });
    expect(title).toBe("Сыворотка для лица с гиалуроновой кислотой 8 в 1 — Via Labote");
    expect(title.length).toBeLessThanOrEqual(70);
    expect(title.length).toBeGreaterThanOrEqual(30);
  });

  it("название из карточки не меняется — правится только title в выдаче", () => {
    const cardTitle = "Увлажняющая сыворотка для лица с гиалуроновой кислотой 8 в 1";
    const title = productSeoTitle({ slug: "serum-8-in-1-white-tea", title: cardTitle });
    expect(cardTitle).toBe("Увлажняющая сыворотка для лица с гиалуроновой кислотой 8 в 1");
    expect(title).not.toBe(`${cardTitle} — Via Labote`);
  });
});
