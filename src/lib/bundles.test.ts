import { describe, it, expect } from "vitest";
import { almostBundles, applyBundles, BUNDLES } from "./bundles";

const l = (slug: string, price: number, quantity = 1) => ({ slug, price, quantity });

describe("наборы −10%", () => {
  it("шесть наборов владельца, все по 10%", () => {
    expect(BUNDLES.map((b) => b.id)).toEqual(["men", "men-2", "clear-skin", "anti-age", "glow", "hydration"]);
    expect(BUNDLES.every((b) => b.percent === 10 && b.parts.length === 2)).toBe(true);
  });
  it("любое масло для бороды + гель-масло = «Мужской» −10%, скидка в целых рублях", () => {
    expect(applyBundles([l("beard-oil-bigman", 50000), l("hydrophilic-gel-oil", 50000)])).toEqual({
      applied: [{ id: "men", title: "Мужской", percent: 10, slugs: ["beard-oil-bigman", "hydrophilic-gel-oil"], discount: 10000 }],
      discount: 10000,
    });
    expect(applyBundles([l("beard-oil-unscented", 59000), l("hydrophilic-gel-oil", 50000)]).discount).toBe(10900);
    expect(applyBundles([l("inci-retinal-serum", 59050), l("toner-serum-ph6", 52000)]).discount).toBe(11100); // 11105 -> вниз до рубля
  });
  it("одна единица — в одном наборе; тоник увлажняющий на два набора — выгоднее для покупателя", () => {
    const r = applyBundles([l("serum-resveratrol-vitamin-c", 63000), l("serum-8-in-1-white-tea", 51000), l("toner-serum-ph6", 52000)]);
    expect(r.applied.map((a) => a.id)).toEqual(["glow"]); // ресвератрол дороже -> больше скидка
    const two = applyBundles([l("serum-resveratrol-vitamin-c", 63000), l("serum-8-in-1-white-tea", 51000), l("toner-serum-ph6", 52000, 2)]);
    expect(two.applied.map((a) => a.id).sort()).toEqual(["glow", "hydration"]);
  });
  it("два масла и два гель-масла — два набора; без пары — скидки нет", () => {
    expect(applyBundles([l("beard-oil-steblev", 55000, 2), l("hydrophilic-gel-oil", 50000, 2)]).applied).toHaveLength(2);
    expect(applyBundles([l("beard-oil-steblev", 55000), l("rosemary-hair-oil", 45000)])).toEqual({ applied: [], discount: 0 });
  });
  it("подсказка: не хватает одной части — какой", () => {
    expect(almostBundles([l("beard-oil-steblev", 55000)]).map((b) => [b.id, b.missing])).toEqual([
      ["men", ["hydrophilic-gel-oil"]],
      ["men-2", ["toner-serum-ph55"]],
    ]);
    expect(almostBundles([l("beard-oil-steblev", 55000), l("hydrophilic-gel-oil", 50000)]).map((b) => b.id)).toEqual([]); // масло уже в «Мужском»
  });
});
