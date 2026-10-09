import { describe, it, expect } from "vitest";
import { resolveDisplayPrice } from "./product-price";

const NOW = new Date("2026-08-23T12:00:00Z");

describe("resolveDisplayPrice", () => {
  it("нет скидки, нет oldPrice -> просто price, без compareAt", () => {
    const r = resolveDisplayPrice({ price: 100000, oldPrice: null, discount: null }, NOW);
    expect(r).toEqual({ price: 100000, compareAtPrice: null, discountApplied: false });
  });

  it("нет активной скидки, есть статичный oldPrice > price -> compareAtPrice = oldPrice", () => {
    const r = resolveDisplayPrice({ price: 90000, oldPrice: 120000, discount: null }, NOW);
    expect(r).toEqual({ price: 90000, compareAtPrice: 120000, discountApplied: false });
  });

  it("oldPrice <= price (некорректные данные) -> не показываем ложный compareAt", () => {
    const r = resolveDisplayPrice({ price: 90000, oldPrice: 90000, discount: null }, NOW);
    expect(r.compareAtPrice).toBeNull();
  });

  it("активная скидка ПЕРЕВЕШИВАЕТ статичный oldPrice", () => {
    const r = resolveDisplayPrice(
      {
        price: 100000,
        oldPrice: 105000, // статичное "было" — должно быть проигнорировано
        discount: { type: "percent", value: 20, startsAt: null, endsAt: null },
      },
      NOW,
    );
    expect(r).toEqual({ price: 80000, compareAtPrice: 100000, discountApplied: true });
  });

  it("истёкшая скидка -> откатываемся на статичный oldPrice, если он есть", () => {
    const r = resolveDisplayPrice(
      {
        price: 100000,
        oldPrice: 110000,
        discount: {
          type: "percent",
          value: 20,
          startsAt: null,
          endsAt: new Date("2026-01-01T00:00:00Z"), // в прошлом относительно NOW
        },
      },
      NOW,
    );
    expect(r).toEqual({ price: 100000, compareAtPrice: 110000, discountApplied: false });
  });

  it("ещё не начавшаяся скидка -> базовая цена, без compareAt (если нет oldPrice)", () => {
    const r = resolveDisplayPrice(
      {
        price: 100000,
        oldPrice: null,
        discount: {
          type: "fixed",
          value: 10000,
          startsAt: new Date("2099-01-01T00:00:00Z"), // в будущем
          endsAt: null,
        },
      },
      NOW,
    );
    expect(r).toEqual({ price: 100000, compareAtPrice: null, discountApplied: false });
  });

  it("повреждённый Discount.type трактуется как отсутствие скидки", () => {
    const r = resolveDisplayPrice(
      { price: 100000, oldPrice: null, discount: { type: "???", value: 1, startsAt: null, endsAt: null } },
      NOW,
    );
    expect(r).toEqual({ price: 100000, compareAtPrice: null, discountApplied: false });
  });
});
