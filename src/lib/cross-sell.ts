// «С этим покупают» на странице товара: пары из наборов, которые задал владелец 2026-11-03.
// Для товара без пары — товары из тех же подборок (Concern), затем из той же категории.
const BEARD = ["beard-oil-steblev", "beard-oil-bigman", "beard-oil-unscented"];

export const CROSS_SELL: Record<string, string[]> = {
  ...Object.fromEntries(BEARD.map((s) => [s, ["hydrophilic-gel-oil", "toner-serum-ph55"]])),
  "hydrophilic-gel-oil": [...BEARD, "toner-serum-ph55"],
  "toner-serum-ph55": ["multi3-anti-acne-serum", "hydrophilic-gel-oil", "beard-oil-steblev"],
  "multi3-anti-acne-serum": ["toner-serum-ph55", "hydrophilic-gel-oil"],
  "toner-serum-ph6": ["inci-retinal-serum", "serum-resveratrol-vitamin-c", "serum-8-in-1-white-tea"],
  "inci-retinal-serum": ["toner-serum-ph6"],
  "serum-resveratrol-vitamin-c": ["toner-serum-ph6"],
  "serum-8-in-1-white-tea": ["toner-serum-ph6"],
};

/** Порядок рекомендаций: сначала пары владельца, затем остальные кандидаты как пришли; без самого товара, до limit. */
export function orderCrossSell<T extends { slug: string }>(slug: string, candidates: T[], limit = 4): T[] {
  const pinned = CROSS_SELL[slug] ?? [];
  const bySlug = new Map(candidates.map((c) => [c.slug, c]));
  const first = pinned.map((s) => bySlug.get(s)).filter((c): c is T => Boolean(c));
  const rest = candidates.filter((c) => c.slug !== slug && !pinned.includes(c.slug));
  return [...first, ...rest].slice(0, limit);
}
