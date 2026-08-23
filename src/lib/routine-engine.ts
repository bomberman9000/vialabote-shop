// Детерминированный подбор ухода: answers → explicit rules → matching products.
// Никакого LLM, никаких медицинских диагнозов. Чистые функции — легко тестируются.

export type Scope = "minimal" | "full";

export const CONCERNS = [
  { slug: "acne", name: "Акне и несовершенства" },
  { slug: "dryness", name: "Сухость" },
  { slug: "dull-tone", name: "Тусклый тон" },
  { slug: "anti-age", name: "Возрастные изменения" },
  { slug: "men", name: "Мужской уход" },
] as const;

export const SKIN_TYPES = [
  { slug: "oily", name: "Жирная" },
  { slug: "dry", name: "Сухая" },
  { slug: "combination", name: "Комбинированная" },
  { slug: "normal", name: "Нормальная" },
  { slug: "sensitive", name: "Чувствительная" },
] as const;

export const SCOPES: { value: Scope; name: string }[] = [
  { value: "minimal", name: "Только активный уход" },
  { value: "full", name: "Полный уход: очищение + активный уход" },
];

export type ConcernSlug = (typeof CONCERNS)[number]["slug"];
export type SkinTypeSlug = (typeof SKIN_TYPES)[number]["slug"];

const CONCERN_NAMES: Record<string, string> = Object.fromEntries(
  CONCERNS.map((c) => [c.slug, c.name]),
);
const SKIN_TYPE_NAMES: Record<string, string> = Object.fromEntries(
  SKIN_TYPES.map((s) => [s.slug, s.name]),
);
const KNOWN_CONCERNS: Set<string> = new Set(CONCERNS.map((c) => c.slug));
const KNOWN_SKIN_TYPES: Set<string> = new Set(SKIN_TYPES.map((s) => s.slug));
const KNOWN_ROLES = new Set(["cleanse", "active", "care"]);

export interface RoutineProduct {
  id: string;
  slug: string;
  title: string;
  price: number;
  imageUrl: string;
  stock: number;
  concernSlugs: string[];
  skinTypeSlugs: string[]; // пусто = подходит всем типам (напр. очищающее масло)
  routineStep: number | null;
  routineRole: string | null; // "cleanse" | "active" | "care"
}

export interface RoutineInput {
  concern: string;
  skinType: string;
  scope: Scope;
}

export interface RoutineStepResult {
  step: number;
  role: string;
  product: RoutineProduct;
  reason: string;
}

export interface RoutineResult {
  steps: RoutineStepResult[];
  isEmpty: boolean;
}

function isValidRoutineProduct(p: RoutineProduct): boolean {
  return (
    typeof p.routineStep === "number" &&
    Number.isInteger(p.routineStep) &&
    p.routineStep >= 1 &&
    p.routineStep <= 10 &&
    typeof p.routineRole === "string" &&
    KNOWN_ROLES.has(p.routineRole) &&
    Array.isArray(p.concernSlugs) &&
    Array.isArray(p.skinTypeSlugs)
  );
}

function buildReason(product: RoutineProduct, concernName: string, skinName: string): string {
  if (product.routineRole === "cleanse") {
    return "Первый шаг — очищение, чтобы кожа была готова к активному уходу.";
  }
  if (product.routineRole === "care") {
    return `Подобран для потребности «${concernName}».`;
  }
  return `Выбран как активный этап ухода, потому что вы указали «${skinName}» и «${concernName}».`;
}

/**
 * Детерминированный подбор: одинаковый input → одинаковый ordered result.
 * Невалидные/неполные product-записи молча исключаются (fail-safe, без исключений).
 * Неизвестные concern/skinType → пустой результат, а не exception и не "ближайшее совпадение".
 */
export function matchRoutine(input: RoutineInput, products: RoutineProduct[]): RoutineResult {
  const concernName = CONCERN_NAMES[input.concern];
  const skinName = SKIN_TYPE_NAMES[input.skinType];

  if (!concernName || !skinName || !KNOWN_CONCERNS.has(input.concern) || !KNOWN_SKIN_TYPES.has(input.skinType)) {
    return { steps: [], isEmpty: true };
  }

  const valid = products.filter(isValidRoutineProduct);

  const eligible = valid.filter((p) => {
    const matchesSkin = p.skinTypeSlugs.length === 0 || p.skinTypeSlugs.includes(input.skinType);
    if (!matchesSkin) return false;

    if (p.routineRole === "cleanse") {
      // Очищение — универсальный подготовительный шаг, включается только
      // в полном уходе, независимо от выбранной потребности.
      return input.scope === "full";
    }
    // active / care обязаны реально относиться к выбранной потребности.
    return p.concernSlugs.includes(input.concern);
  });

  // Dedup по id (на случай дублей во входных данных) — сохраняет детерминированность.
  const byId = new Map<string, RoutineProduct>();
  for (const p of eligible) {
    if (!byId.has(p.id)) byId.set(p.id, p);
  }

  // Сортировка по routineStep, а при равенстве — по id (стабильный tie-break).
  // Array.prototype.sort в V8 гарантированно стабилен (ES2019+), но сама
  // стабильность бесполезна, если порядок ДО сортировки уже зависит от
  // порядка входного массива products — explicit tie-break на id убирает
  // эту зависимость полностью, а не просто полагается на стабильность sort.
  const steps: RoutineStepResult[] = Array.from(byId.values())
    .sort((a, b) => {
      const stepDiff = (a.routineStep as number) - (b.routineStep as number);
      if (stepDiff !== 0) return stepDiff;
      return a.id.localeCompare(b.id);
    })
    .map((product) => ({
      step: product.routineStep as number,
      role: product.routineRole as string,
      product,
      reason: buildReason(product, concernName, skinName),
    }));

  return { steps, isEmpty: steps.length === 0 };
}
