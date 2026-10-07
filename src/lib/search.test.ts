import { describe, expect, it } from "vitest";
import { normalizeSearchText, searchProducts, type SearchProduct } from "./search";

const product = (over: Partial<SearchProduct> & Pick<SearchProduct, "id" | "title">): SearchProduct => ({
  slug: over.id,
  subtitle: null,
  imageUrl: "/x.webp",
  price: 1000,
  oldPrice: null,
  haystack: normalizeSearchText(over.title),
  ...over,
});

const catalog: SearchProduct[] = [
  product({ id: "retinal", title: "INCI Retinal Serum", haystack: normalizeSearchText("INCI Retinal Serum Ретиналь витамин B5 пробиотики anti-age упругость") }),
  product({ id: "8in1", title: "Сыворотка 8 in 1 White Tea", haystack: normalizeSearchText("Сыворотка 8 in 1 увлажнение тонус ретинол-free") }),
  product({ id: "oil", title: "Гидрофильное гель-масло", haystack: normalizeSearchText("Гидрофильное гель-масло очищение умывание") }),
];

describe("normalizeSearchText", () => {
  it("lowercases, folds ё→е and strips punctuation", () => {
    expect(normalizeSearchText("Тёплый  ГЕЛЬ-масло!")).toBe("теплый гель масло");
  });
});

describe("searchProducts", () => {
  it("returns nothing for an empty query", () => {
    expect(searchProducts(catalog, "   ")).toEqual([]);
  });

  it("matches word prefixes in title and haystack", () => {
    // равный вес (совпадение только в описании) → порядок по названию, поэтому сравниваем множество
    expect(searchProducts(catalog, "ретин").map((p) => p.id).sort()).toEqual(["8in1", "retinal"]);
  });

  it("ranks title matches above description matches", () => {
    const ids = searchProducts(catalog, "ret").map((p) => p.id);
    expect(ids[0]).toBe("retinal");
  });

  it("requires every query word (AND)", () => {
    expect(searchProducts(catalog, "гель умыв").map((p) => p.id)).toEqual(["oil"]);
    expect(searchProducts(catalog, "гель ретин")).toEqual([]);
  });

  it("does not match inside words", () => {
    expect(searchProducts(catalog, "иналь")).toEqual([]);
  });

  it("respects the limit", () => {
    expect(searchProducts(catalog, "с", 1)).toHaveLength(1);
  });
});
