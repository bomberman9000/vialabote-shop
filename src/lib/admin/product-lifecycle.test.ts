import { describe, it, expect } from "vitest";
import { deriveIsActive, canTransition, buildLifecycleFields, isProductStatus } from "./product-lifecycle";

describe("deriveIsActive — единственный источник isActive", () => {
  it("published -> true", () => expect(deriveIsActive("published")).toBe(true));
  it("draft -> false", () => expect(deriveIsActive("draft")).toBe(false));
  it("archived -> false", () => expect(deriveIsActive("archived")).toBe(false));
});

describe("buildLifecycleFields — инвариант status/isActive не может рассинхронизироваться", () => {
  it("никогда не возвращает isActive=true при status != published", () => {
    for (const status of ["draft", "archived"] as const) {
      const fields = buildLifecycleFields(status);
      expect(fields.isActive).toBe(false);
    }
  });
  it("published всегда даёт isActive=true", () => {
    expect(buildLifecycleFields("published")).toEqual({ status: "published", isActive: true });
  });
});

describe("canTransition — разрешённые переходы", () => {
  it("draft -> published разрешён", () => expect(canTransition("draft", "published")).toBe(true));
  it("published -> archived разрешён", () => expect(canTransition("published", "archived")).toBe(true));
  it("archived -> published разрешён (переиздание)", () =>
    expect(canTransition("archived", "published")).toBe(true));
  it("одинаковый статус (no-op) разрешён идемпотентно", () =>
    expect(canTransition("published", "published")).toBe(true));
});

describe("isProductStatus — валидация неизвестных значений", () => {
  it("отклоняет произвольную строку", () => {
    expect(isProductStatus("deleted")).toBe(false);
    expect(isProductStatus("")).toBe(false);
  });
  it("принимает только 3 канонических значения", () => {
    expect(isProductStatus("draft")).toBe(true);
    expect(isProductStatus("published")).toBe(true);
    expect(isProductStatus("archived")).toBe(true);
  });
});
