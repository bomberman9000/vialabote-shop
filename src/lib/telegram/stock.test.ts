// @vitest-environment node
import { describe, it, expect } from "vitest";
import { applyStep, clampStock, MAX_STOCK, parseStockInput, stockEditorText, stockPreview } from "./stock";

describe("stock buttons", () => {
  it("+/- never go below 0 or above the max", () => {
    expect(applyStep(3, -10)).toBe(0);
    expect(applyStep(0, -1)).toBe(0);
    expect(applyStep(5, 1)).toBe(6);
    expect(applyStep(MAX_STOCK, 10)).toBe(MAX_STOCK);
    expect(clampStock(Number.NaN)).toBe(0);
    expect(clampStock(2.9)).toBe(2);
  });
});

describe("stock typed input", () => {
  it.each([
    ["12", 5, 12],
    ["=12", 5, 12],
    [" 0 ", 5, 0],
    ["+5", 5, 10],
    ["-3", 5, 2],
    ["- 5", 5, 0],
    ["7 шт", 5, 7],
  ])("%j with current %i -> %i", (text, current, value) => {
    expect(parseStockInput(text, current)).toEqual({ ok: true, value });
  });

  it.each(["", "abc", "1.5", "1,5", "--1", "12a", "+"])("rejects %j", (text) => {
    expect(parseStockInput(text, 5).ok).toBe(false);
  });

  it("rejects a negative result instead of clamping silently", () => {
    const r = parseStockInput("-6", 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("отрицательным");
  });

  it("rejects values above the max", () => {
    expect(parseStockInput(String(MAX_STOCK + 1), 0).ok).toBe(false);
    expect(parseStockInput(`+${MAX_STOCK}`, 1).ok).toBe(false);
  });
});

describe("stock texts", () => {
  it("preview shows was / will be / delta", () => {
    expect(stockPreview("Крем", 5, 12)).toBe("Остаток «Крем»\nбыло: 5 шт.\nстанет: 12 шт. (+7)");
    expect(stockPreview("Крем", 5, 0)).toContain("(-5)");
  });
  it("editor shows the draft against the DB value", () => {
    expect(stockEditorText("Крем", 5, 5)).toContain("без изменений");
    expect(stockEditorText("Крем", 5, 15)).toContain("15 шт. (+10)");
  });
});
