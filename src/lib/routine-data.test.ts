import { describe, it, expect } from "vitest";
import { ROUTINE_TAGS } from "./routine-data";
import { CONCERNS, SKIN_TYPES } from "./routine-engine";

const KNOWN_CONCERNS: Set<string> = new Set(CONCERNS.map((c) => c.slug));
const KNOWN_SKIN_TYPES: Set<string> = new Set(SKIN_TYPES.map((s) => s.slug));
const KNOWN_ROLES = new Set(["cleanse", "active", "care"]);
const ALL_6_SKUS = [
  "serum-8-in-1-white-tea",
  "serum-resveratrol-vitamin-c",
  "inci-retinal-serum",
  "multi3-anti-acne-serum",
  "hydrophilic-gel-oil",
  "beard-oil-steblev",
];

describe("ROUTINE_TAGS — валидация данных для 6 SKU", () => {
  it("каждый из 6 существующих SKU присутствует в ROUTINE_TAGS", () => {
    const taggedSlugs = ROUTINE_TAGS.map((t) => t.slug);
    for (const slug of ALL_6_SKUS) {
      expect(taggedSlugs).toContain(slug);
    }
  });

  it("нет лишних/неизвестных slug (не из текущего каталога)", () => {
    for (const tag of ROUTINE_TAGS) {
      expect(ALL_6_SKUS).toContain(tag.slug);
    }
  });

  it("все concernSlugs — из известного enum, неизвестные значения запрещены", () => {
    for (const tag of ROUTINE_TAGS) {
      for (const c of tag.concernSlugs) {
        expect(KNOWN_CONCERNS.has(c), `неизвестный concern "${c}" у ${tag.slug}`).toBe(true);
      }
    }
  });

  it("все skinTypeSlugs — из известного enum, неизвестные значения запрещены", () => {
    for (const tag of ROUTINE_TAGS) {
      for (const s of tag.skinTypeSlugs) {
        expect(KNOWN_SKIN_TYPES.has(s), `неизвестный skinType "${s}" у ${tag.slug}`).toBe(true);
      }
    }
  });

  it("routineRole — только известные значения", () => {
    for (const tag of ROUTINE_TAGS) {
      expect(KNOWN_ROLES.has(tag.routineRole), `неизвестная роль у ${tag.slug}`).toBe(true);
    }
  });

  it("routineStep в допустимом диапазоне (1–10)", () => {
    for (const tag of ROUTINE_TAGS) {
      expect(tag.routineStep).toBeGreaterThanOrEqual(1);
      expect(tag.routineStep).toBeLessThanOrEqual(10);
    }
  });

  it("concernSlugs и skinTypeSlugs не содержат дублей внутри одного товара", () => {
    for (const tag of ROUTINE_TAGS) {
      expect(new Set(tag.concernSlugs).size).toBe(tag.concernSlugs.length);
      expect(new Set(tag.skinTypeSlugs).size).toBe(tag.skinTypeSlugs.length);
    }
  });

  it("нет дублирующихся записей slug в самом ROUTINE_TAGS", () => {
    const slugs = ROUTINE_TAGS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("каждый concern из CONCERNS покрыт хотя бы одним товаром (иначе Step 1 предложит опцию без результата)", () => {
    for (const concern of CONCERNS) {
      const hasProduct = ROUTINE_TAGS.some((t) => t.concernSlugs.includes(concern.slug));
      expect(hasProduct, `concern "${concern.slug}" не подтверждён ни одним товаром`).toBe(true);
    }
  });

  it("hardening: production skinTypeSlugs пусты — ни один skinType-таргетинг не подтверждён владельцем бренда", () => {
    // Намеренная защита от регрессии: пока владелец бренда не подтвердит
    // реальный skinType по SKU, поле, которое реально уходит в БД (и в
    // recommendation engine), должно оставаться [] — т.е. "подходит всем".
    // Черновые гипотезы живут отдельно в draftSkinTypeSlugs и в seed не идут.
    for (const tag of ROUTINE_TAGS) {
      expect(
        tag.skinTypeSlugs,
        `${tag.slug}: production skinTypeSlugs должен быть пуст, пока не подтверждено владельцем`,
      ).toEqual([]);
    }
  });

  it("draftSkinTypeSlugs — валидные enum-значения (даже как черновик не должны содержать мусор)", () => {
    for (const tag of ROUTINE_TAGS) {
      for (const s of tag.draftSkinTypeSlugs) {
        expect(KNOWN_SKIN_TYPES.has(s), `неизвестный draft skinType "${s}" у ${tag.slug}`).toBe(true);
      }
    }
  });
});
