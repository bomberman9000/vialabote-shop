// Наборы со скидкой (решение владельца 2026-11-03). Скидка срабатывает сама, если в корзине есть все части
// набора; одна единица товара — только в одном наборе; при пересечении берётся самый выгодный для покупателя.
// Чистая функция: одинаково считает корзина в браузере и сервер при оформлении (сумму решает сервер).
const BEARD = ["beard-oil-steblev", "beard-oil-bigman", "beard-oil-unscented"];

export interface Bundle {
  id: string;
  title: string;
  /** части набора; в каждой — подходящие товары (любой из них) */
  parts: string[][];
  percent: number;
}

export const BUNDLES: Bundle[] = [
  { id: "men", title: "Мужской", parts: [BEARD, ["hydrophilic-gel-oil"]], percent: 10 },
  { id: "men-2", title: "Мужской 2", parts: [BEARD, ["toner-serum-ph55"]], percent: 10 },
  { id: "clear-skin", title: "Чистая кожа", parts: [["toner-serum-ph55"], ["multi3-anti-acne-serum"]], percent: 10 },
  { id: "anti-age", title: "Anti-age", parts: [["inci-retinal-serum"], ["toner-serum-ph6"]], percent: 10 },
  { id: "glow", title: "Сияние", parts: [["serum-resveratrol-vitamin-c"], ["toner-serum-ph6"]], percent: 10 },
  { id: "hydration", title: "Увлажнение", parts: [["serum-8-in-1-white-tea"], ["toner-serum-ph6"]], percent: 10 },
];

/** Короткие названия для подсказки «добавьте … — и получите −10%». */
export const BUNDLE_ITEM_NAMES: Record<string, string> = {
  "beard-oil-steblev": "масло для бороды",
  "beard-oil-bigman": "масло для бороды",
  "beard-oil-unscented": "масло для бороды",
  "hydrophilic-gel-oil": "гидрофильное гель-масло",
  "toner-serum-ph55": "тоник мультиактивный pH 5.5",
  "multi3-anti-acne-serum": "сыворотку MULTI 3 против акне",
  "inci-retinal-serum": "сыворотку с ретиналем",
  "toner-serum-ph6": "тоник увлажняющий pH 6.0",
  "serum-resveratrol-vitamin-c": "сыворотку с ресвератролом",
  "serum-8-in-1-white-tea": "сыворотку 8 в 1",
};

/** Витрина наборов на главной: какой товар показывать за «любое масло» и короткое описание. */
export const BUNDLE_SHOWCASE: Record<string, { slugs: string[]; subtitle: string }> = {
  men: { slugs: ["beard-oil-steblev", "hydrophilic-gel-oil"], subtitle: "Любое масло для бороды + гидрофильное гель-масло" },
  "men-2": { slugs: ["beard-oil-bigman", "toner-serum-ph55"], subtitle: "Любое масло для бороды + тоник мультиактивный" },
  "clear-skin": { slugs: ["toner-serum-ph55", "multi3-anti-acne-serum"], subtitle: "Тоник мультиактивный + сыворотка MULTI 3 против акне" },
  "anti-age": { slugs: ["inci-retinal-serum", "toner-serum-ph6"], subtitle: "Сыворотка с ретиналем + тоник увлажняющий" },
  glow: { slugs: ["serum-resveratrol-vitamin-c", "toner-serum-ph6"], subtitle: "Сыворотка с ресвератролом + тоник увлажняющий" },
  hydration: { slugs: ["serum-8-in-1-white-tea", "toner-serum-ph6"], subtitle: "Сыворотка 8 в 1 + тоник увлажняющий" },
};

export interface BundleLine {
  slug: string;
  /** цена за штуку, копейки (уже со скидкой товара) */
  price: number;
  quantity: number;
}

export interface AppliedBundle {
  id: string;
  title: string;
  percent: number;
  slugs: string[];
  /** скидка, копейки (на рубли вниз — без копеек) */
  discount: number;
}

/** Взять по одной единице на каждую часть набора — самую дорогую из подходящих (выгоднее покупателю). */
function pick(bundle: Bundle, left: Map<string, { price: number; qty: number }>): string[] | null {
  const used = new Map<string, number>();
  const slugs: string[] = [];
  for (const part of bundle.parts) {
    const best = part
      .filter((s) => (left.get(s)?.qty ?? 0) - (used.get(s) ?? 0) > 0)
      .sort((a, b) => left.get(b)!.price - left.get(a)!.price)[0];
    if (!best) return null;
    used.set(best, (used.get(best) ?? 0) + 1);
    slugs.push(best);
  }
  return slugs;
}

const discountOf = (bundle: Bundle, slugs: string[], left: Map<string, { price: number }>) =>
  Math.floor((slugs.reduce((sum, s) => sum + left.get(s)!.price, 0) * bundle.percent) / 100 / 100) * 100;

/** Наборы в корзине: жадно, каждый раз самый выгодный из доступных, пока что-то собирается. */
export function applyBundles(lines: BundleLine[]): { applied: AppliedBundle[]; discount: number } {
  const left = new Map<string, { price: number; qty: number }>();
  for (const l of lines) {
    const cur = left.get(l.slug);
    left.set(l.slug, { price: Math.max(cur?.price ?? 0, l.price), qty: (cur?.qty ?? 0) + l.quantity });
  }
  const applied: AppliedBundle[] = [];
  for (;;) {
    let best: { bundle: Bundle; slugs: string[]; discount: number } | null = null;
    for (const bundle of BUNDLES) {
      const slugs = pick(bundle, left);
      if (!slugs) continue;
      const discount = discountOf(bundle, slugs, left);
      if (discount > 0 && (!best || discount > best.discount)) best = { bundle, slugs, discount };
    }
    if (!best) break;
    for (const s of best.slugs) left.get(s)!.qty -= 1;
    applied.push({ id: best.bundle.id, title: best.bundle.title, percent: best.bundle.percent, slugs: best.slugs, discount: best.discount });
  }
  return { applied, discount: applied.reduce((sum, a) => sum + a.discount, 0) };
}

/**
 * Наборы, которым не хватает одной части: «добавьте X — и получите −10%». Считаем только по единицам,
 * не вошедшим в уже собранные наборы: масло из «Мужского» не подсказывает «Мужской 2».
 */
export function almostBundles(lines: BundleLine[]): { id: string; title: string; percent: number; missing: string[] }[] {
  const { applied } = applyBundles(lines);
  const left = new Map<string, number>();
  for (const l of lines) left.set(l.slug, (left.get(l.slug) ?? 0) + l.quantity);
  for (const a of applied) for (const s of a.slugs) left.set(s, left.get(s)! - 1);
  const have = new Set([...left].filter(([, q]) => q > 0).map(([s]) => s));
  return BUNDLES
    .map((b) => ({ b, missingParts: b.parts.filter((part) => !part.some((s) => have.has(s))) }))
    .filter(({ b, missingParts }) => missingParts.length === 1 && b.parts.length > 1)
    .map(({ b, missingParts }) => ({ id: b.id, title: b.title, percent: b.percent, missing: missingParts[0] }));
}
