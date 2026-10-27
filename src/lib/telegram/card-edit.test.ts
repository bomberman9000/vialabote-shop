// @vitest-environment node
import { describe, it, expect } from "vitest";
import { cardPreview, parsePriceRubles, parseTextField, visibilityPreview } from "./card-edit";

const money = (k: number) => `${k / 100} ₽`;
const product = { title: "Крем", price: 219000, description: "Старое", activeIngredients: null, status: "published" };

describe("card edit input", () => {
  it.each([
    ["2190", 219000],
    ["2 190", 219000],
    ["2190,50", 219050],
    ["2190.5", 219050],
    ["2190₽", 219000],
    ["2190 руб.", 219000],
  ])("price %j -> %i kopecks", (t, k) => {
    expect(parsePriceRubles(t)).toEqual({ ok: true, value: k });
  });
  it.each(["0", "-5", "abc", "1.234", ""])("price %j rejected", (t) => {
    expect(parsePriceRubles(t).ok).toBe(false);
  });
  it("title/inci/desc bounds", () => {
    expect(parseTextField("title", "x").ok).toBe(false);
    expect(parseTextField("title", "  Новый крем  ")).toEqual({ ok: true, value: "Новый крем" });
    expect(parseTextField("title", "x".repeat(201)).ok).toBe(false);
    expect(parseTextField("desc", "x".repeat(5001)).ok).toBe(false);
    expect(parseTextField("inci", "Aqua, Glycerin").ok).toBe(true);
    expect(parseTextField("inci", "x".repeat(2001)).ok).toBe(false);
  });
});

describe("card previews", () => {
  it("shows was -> will be", () => {
    expect(cardPreview("price", product, 250000, money)).toContain("было: 2190 ₽\nстанет: 2500 ₽");
    expect(cardPreview("title", product, "Новый", money)).toContain("было: Крем\nстанет: Новый");
    expect(cardPreview("inci", product, "Aqua", money)).toContain("было: —\nстанет: Aqua");
  });
  it("visibility in words", () => {
    expect(visibilityPreview("Крем", "published", "draft")).toBe("Видимость «Крем»\nбыло: виден на сайте\nстанет: скрыт (черновик)");
  });
});
