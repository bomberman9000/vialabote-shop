import { describe, it, expect } from "vitest";
import { orderCrossSell } from "./cross-sell";
import { customerDeliveryPrice, FREE_DELIVERY_FROM_KOPECKS } from "./delivery/free-delivery";

const p = (slug: string) => ({ slug });

describe("«С этим покупают»", () => {
  it("сначала пары из наборов владельца, потом остальные кандидаты; без самого товара; не больше 4", () => {
    const cands = ["beard-oil-bigman", "rosemary-hair-oil", "toner-serum-ph55", "beard-oil-steblev", "hydrophilic-gel-oil", "x", "y"].map(p);
    expect(orderCrossSell("beard-oil-steblev", cands).map((c) => c.slug)).toEqual(["hydrophilic-gel-oil", "toner-serum-ph55", "beard-oil-bigman", "rosemary-hair-oil"]);
  });
  it("товар без пар — кандидаты как пришли", () => {
    expect(orderCrossSell("body-butter-mimosa-cardamom", ["a", "b"].map(p)).map((c) => c.slug)).toEqual(["a", "b"]);
  });
});

describe("бесплатная доставка", () => {
  it("порог 2 500 ₽: от него покупатель не платит, ниже — тариф Ozon", () => {
    expect(FREE_DELIVERY_FROM_KOPECKS).toBe(250_000);
    expect(customerDeliveryPrice(250_000, 9400)).toBe(0);
    expect(customerDeliveryPrice(249_999, 9400)).toBe(9400);
  });
});
