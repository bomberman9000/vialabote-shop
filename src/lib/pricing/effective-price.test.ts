import { describe, it, expect } from "vitest";
import { effectivePrice, toDiscountInput } from "./effective-price";

const NOW = new Date("2026-08-23T12:00:00Z");

describe("effectivePrice — без скидки", () => {
  it("null discount -> цена без изменений", () => {
    const r = effectivePrice(100000, null, NOW);
    expect(r).toEqual({
      originalPrice: 100000,
      effectivePrice: 100000,
      discountApplied: false,
      discountAmount: 0,
    });
  });
});

describe("effectivePrice — percent", () => {
  it("15% скидка", () => {
    const r = effectivePrice(100000, { type: "percent", value: 15, startsAt: null, endsAt: null }, NOW);
    expect(r.effectivePrice).toBe(85000);
    expect(r.discountApplied).toBe(true);
    expect(r.discountAmount).toBe(15000);
  });

  it("percent > 100 клампится к 100 (не уходит в отрицательную цену)", () => {
    const r = effectivePrice(100000, { type: "percent", value: 150, startsAt: null, endsAt: null }, NOW);
    expect(r.effectivePrice).toBe(0);
  });

  it("отрицательный percent клампится к 0 (скидка не может УВЕЛИЧИТЬ цену)", () => {
    const r = effectivePrice(100000, { type: "percent", value: -20, startsAt: null, endsAt: null }, NOW);
    expect(r.effectivePrice).toBe(100000);
  });
});

describe("effectivePrice — fixed", () => {
  it("фиксированная скидка в копейках", () => {
    const r = effectivePrice(100000, { type: "fixed", value: 20000, startsAt: null, endsAt: null }, NOW);
    expect(r.effectivePrice).toBe(80000);
  });

  it("fixed больше цены — эффективная цена не уходит в минус", () => {
    const r = effectivePrice(100000, { type: "fixed", value: 999999, startsAt: null, endsAt: null }, NOW);
    expect(r.effectivePrice).toBe(0);
  });
});

describe("effectivePrice — временное окно (startsAt/endsAt)", () => {
  it("скидка ещё не началась — цена без изменений", () => {
    const future = new Date(NOW.getTime() + 86400000);
    const r = effectivePrice(100000, { type: "percent", value: 15, startsAt: future, endsAt: null }, NOW);
    expect(r.discountApplied).toBe(false);
    expect(r.effectivePrice).toBe(100000);
  });

  it("скидка уже закончилась — цена без изменений (автоматически, без ручного выключения)", () => {
    const past = new Date(NOW.getTime() - 86400000);
    const r = effectivePrice(100000, { type: "percent", value: 15, startsAt: null, endsAt: past }, NOW);
    expect(r.discountApplied).toBe(false);
    expect(r.effectivePrice).toBe(100000);
  });

  it("сейчас точно внутри окна — скидка применяется", () => {
    const start = new Date(NOW.getTime() - 3600000);
    const end = new Date(NOW.getTime() + 3600000);
    const r = effectivePrice(100000, { type: "percent", value: 15, startsAt: start, endsAt: end }, NOW);
    expect(r.discountApplied).toBe(true);
  });

  it("границы включительны: now === endsAt -> скидка ещё действует", () => {
    const r = effectivePrice(100000, { type: "percent", value: 15, startsAt: null, endsAt: NOW }, NOW);
    expect(r.discountApplied).toBe(true);
  });

  it("now === startsAt -> скидка уже действует", () => {
    const r = effectivePrice(100000, { type: "percent", value: 15, startsAt: NOW, endsAt: null }, NOW);
    expect(r.discountApplied).toBe(true);
  });
});

describe("effectivePrice — детерминизм", () => {
  it("один и тот же вход всегда даёт один и тот же результат", () => {
    const discount = { type: "percent" as const, value: 15, startsAt: null, endsAt: null };
    const r1 = effectivePrice(60400, discount, NOW);
    const r2 = effectivePrice(60400, discount, NOW);
    expect(r1).toEqual(r2);
  });
});

describe("toDiscountInput — конвертация сырого Prisma Discount", () => {
  it("null -> null", () => {
    expect(toDiscountInput(null)).toBeNull();
  });

  it("undefined -> null", () => {
    expect(toDiscountInput(undefined)).toBeNull();
  });

  it("валидный percent -> DiscountInput как есть", () => {
    const raw = { type: "percent", value: 15, startsAt: null, endsAt: null };
    expect(toDiscountInput(raw)).toEqual(raw);
  });

  it("валидный fixed -> DiscountInput как есть", () => {
    const raw = { type: "fixed", value: 5000, startsAt: null, endsAt: null };
    expect(toDiscountInput(raw)).toEqual(raw);
  });

  it("неизвестный type трактуется как отсутствие скидки, не падает", () => {
    const raw = { type: "buy_one_get_one", value: 1, startsAt: null, endsAt: null };
    expect(toDiscountInput(raw)).toBeNull();
  });
});
