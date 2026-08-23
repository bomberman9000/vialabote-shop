import { describe, it, expect } from "vitest";
import { matchRoutine, type RoutineProduct, type RoutineInput } from "./routine-engine";

function product(overrides: Partial<RoutineProduct> = {}): RoutineProduct {
  return {
    id: "p1",
    slug: "test-product",
    title: "Test Product",
    price: 50000,
    imageUrl: "/images/products/test.webp",
    stock: 10,
    concernSlugs: ["acne"],
    skinTypeSlugs: [],
    routineStep: 2,
    routineRole: "active",
    ...overrides,
  };
}

const cleanser = product({
  id: "cleanser",
  slug: "cleanser",
  concernSlugs: [],
  skinTypeSlugs: [],
  routineStep: 1,
  routineRole: "cleanse",
});

const acneActive = product({
  id: "acne-active",
  slug: "acne-active",
  concernSlugs: ["acne"],
  skinTypeSlugs: ["oily", "combination"],
  routineStep: 2,
  routineRole: "active",
});

const dryActive = product({
  id: "dry-active",
  slug: "dry-active",
  concernSlugs: ["dryness"],
  skinTypeSlugs: [], // подходит всем типам
  routineStep: 2,
  routineRole: "active",
});

const baseInput: RoutineInput = { concern: "acne", skinType: "oily", scope: "full" };

describe("matchRoutine — determinism", () => {
  it("одинаковый input всегда даёт одинаковый ordered result", () => {
    const products = [cleanser, acneActive, dryActive];
    const r1 = matchRoutine(baseInput, products);
    const r2 = matchRoutine({ ...baseInput }, [...products]);
    expect(r1).toEqual(r2);
  });

  it("не зависит от порядка записей во входном массиве", () => {
    const forward = matchRoutine(baseInput, [cleanser, acneActive]);
    const reversed = matchRoutine(baseInput, [acneActive, cleanser]);
    expect(forward.steps.map((s) => s.product.id)).toEqual(reversed.steps.map((s) => s.product.id));
  });
});

describe("matchRoutine — concern matching", () => {
  it("продукт с несовпадающим concern не попадает в результат", () => {
    const result = matchRoutine(baseInput, [dryActive]); // dryActive относится к "dryness", не "acne"
    expect(result.isEmpty).toBe(true);
    expect(result.steps).toHaveLength(0);
  });

  it("продукт с совпадающим concern попадает в результат", () => {
    const result = matchRoutine(baseInput, [acneActive]);
    expect(result.steps.map((s) => s.product.id)).toEqual(["acne-active"]);
  });
});

describe("matchRoutine — skin type matching", () => {
  it("продукт, подходящий нескольким типам кожи, матчится на каждый разрешённый тип", () => {
    for (const skinType of ["oily", "combination"]) {
      const result = matchRoutine({ concern: "acne", skinType, scope: "minimal" }, [acneActive]);
      expect(result.steps.map((s) => s.product.id)).toEqual(["acne-active"]);
    }
  });

  it("продукт, не подходящий выбранному типу кожи, не попадает в результат", () => {
    const result = matchRoutine({ concern: "acne", skinType: "dry", scope: "minimal" }, [acneActive]);
    expect(result.isEmpty).toBe(true);
  });

  it("пустой skinTypeSlugs = подходит любому типу кожи", () => {
    const result = matchRoutine({ concern: "dryness", skinType: "sensitive", scope: "minimal" }, [
      dryActive,
    ]);
    expect(result.steps.map((s) => s.product.id)).toEqual(["dry-active"]);
  });
});

describe("matchRoutine — routine ordering", () => {
  it("результат строго сортируется по routineStep, независимо от порядка в массиве", () => {
    const step3 = product({ id: "step3", routineStep: 3, routineRole: "care", concernSlugs: ["acne"] });
    const step1 = cleanser;
    const step2 = acneActive;
    // Специально передаём в "неправильном" порядке
    const result = matchRoutine({ ...baseInput, scope: "full" }, [step3, step1, step2]);
    expect(result.steps.map((s) => s.step)).toEqual([1, 2, 3]);
    expect(result.steps.map((s) => s.product.id)).toEqual(["cleanser", "acne-active", "step3"]);
  });
});

describe("matchRoutine — приоритет (scope) реально влияет на результат", () => {
  it("minimal исключает шаг очищения, full включает", () => {
    const minimal = matchRoutine({ ...baseInput, scope: "minimal" }, [cleanser, acneActive]);
    const full = matchRoutine({ ...baseInput, scope: "full" }, [cleanser, acneActive]);

    expect(minimal.steps.map((s) => s.role)).toEqual(["active"]);
    expect(full.steps.map((s) => s.role)).toEqual(["cleanse", "active"]);
    expect(minimal.steps.length).not.toBe(full.steps.length);
  });
});

describe("matchRoutine — empty result", () => {
  it("при отсутствии совпадений возвращает явный пустой результат, без random SKU", () => {
    const result = matchRoutine(baseInput, []);
    expect(result.isEmpty).toBe(true);
    expect(result.steps).toEqual([]);
  });

  it("неизвестный concern → пустой результат, а не исключение", () => {
    expect(() =>
      matchRoutine({ concern: "unknown-concern", skinType: "oily", scope: "full" }, [acneActive]),
    ).not.toThrow();
    const result = matchRoutine({ concern: "unknown-concern", skinType: "oily", scope: "full" }, [
      acneActive,
    ]);
    expect(result.isEmpty).toBe(true);
  });

  it("неизвестный skinType → пустой результат, а не исключение", () => {
    const result = matchRoutine({ concern: "acne", skinType: "unknown-skin", scope: "full" }, [
      acneActive,
    ]);
    expect(result.isEmpty).toBe(true);
  });
});

describe("matchRoutine — duplicate protection", () => {
  it("один SKU не появляется дважды в одном routine, даже если продублирован во входных данных", () => {
    const result = matchRoutine(baseInput, [acneActive, acneActive, cleanser]);
    const ids = result.steps.map((s) => s.product.id);
    expect(ids).toEqual(Array.from(new Set(ids)));
  });
});

describe("matchRoutine — invalid data (fail-safe)", () => {
  it("продукт без routineStep не попадает в результат и не бросает исключение", () => {
    const broken = product({ id: "broken", routineStep: null });
    expect(() => matchRoutine(baseInput, [broken])).not.toThrow();
    expect(matchRoutine(baseInput, [broken]).isEmpty).toBe(true);
  });

  it("продукт с неизвестным routineRole не попадает в результат", () => {
    const broken = product({ id: "broken-role", routineRole: "does-not-exist" });
    const result = matchRoutine(baseInput, [broken]);
    expect(result.isEmpty).toBe(true);
  });

  it("продукт с routineStep вне диапазона (0 или >10) не попадает в результат", () => {
    const zero = product({ id: "zero-step", routineStep: 0 });
    const tooHigh = product({ id: "too-high", routineStep: 11 });
    const result = matchRoutine(baseInput, [zero, tooHigh]);
    expect(result.isEmpty).toBe(true);
  });

  it("пустой массив продуктов не бросает исключение", () => {
    expect(() => matchRoutine(baseInput, [])).not.toThrow();
  });
});

describe("matchRoutine — стабильный порядок при равном routineStep (property/shuffle)", () => {
  // Три товара с ОДИНАКОВЫМ routineStep=2 и одинаковым concern/skinType —
  // единственное, что должно определять порядок в результате, это id (tie-break),
  // а не порядок, в котором они лежали во входном массиве products.
  const tieA = product({ id: "tie-c", routineStep: 2 });
  const tieB = product({ id: "tie-a", routineStep: 2 });
  const tieC = product({ id: "tie-b", routineStep: 2 });
  const expectedOrder = ["tie-a", "tie-b", "tie-c"]; // localeCompare-порядок id

  function permutations<T>(arr: T[]): T[][] {
    if (arr.length <= 1) return [arr];
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i++) {
      const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
      for (const perm of permutations(rest)) {
        result.push([arr[i], ...perm]);
      }
    }
    return result;
  }

  it("результат идентичен для ВСЕХ перестановок входного массива (исчерпывающий перебор)", () => {
    for (const perm of permutations([tieA, tieB, tieC])) {
      const result = matchRoutine(baseInput, perm);
      expect(result.steps.map((s) => s.product.id)).toEqual(expectedOrder);
    }
  });

  it("результат идентичен для случайных shuffle большего набора (seeded PRNG, воспроизводимо)", () => {
    // Простой детерминированный (seeded) PRNG — без внешней property-testing
    // библиотеки, но воспроизводимо между запусками (не Math.random()).
    function mulberry32(seed: number) {
      return function () {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function shuffle<T>(arr: T[], rng: () => number): T[] {
      const copy = [...arr];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    }

    const pool = [
      cleanser,
      tieA,
      tieB,
      tieC,
      product({ id: "tie-d", routineStep: 2 }),
      product({ id: "tie-e", routineStep: 2 }),
    ];
    const rng = mulberry32(42);
    const baselineResult = matchRoutine({ ...baseInput, scope: "full" }, pool).steps.map(
      (s) => s.product.id,
    );

    for (let run = 0; run < 50; run++) {
      const shuffled = shuffle(pool, rng);
      const result = matchRoutine({ ...baseInput, scope: "full" }, shuffled);
      expect(result.steps.map((s) => s.product.id)).toEqual(baselineResult);
    }
  });
});
