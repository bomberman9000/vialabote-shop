// Резолвит свободный текст ("Multi3", "retinal serum") в конкретный Product.
// НИКОГДА не угадывает: при >1 совпадении возвращает кандидатов на уточнение,
// при 0 — not_found. Вызывающий код (Telegram handler) сам решает, как
// показать это оператору — резолвер только читает БД, ничего не исполняет.

import { prisma } from "@/lib/prisma";

export interface ProductCandidate {
  id: string;
  title: string;
  slug: string;
  status: string;
  version: number;
  price: number;
}

export type ProductResolution =
  | { status: "found"; product: ProductCandidate }
  | { status: "ambiguous"; candidates: ProductCandidate[] }
  | { status: "not_found" };

const SELECT = { id: true, title: true, slug: true, status: true, version: true, price: true } as const;

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Порядок разрешения (каждый шаг применяется только если предыдущий не дал
 * однозначного результата):
 *  1. Точное совпадение по slug — самый однозначный идентификатор.
 *  2. Точное совпадение по title (без учёта регистра).
 *  3. Частичное совпадение — title содержит query.
 * Если на любом шаге совпадений больше одного — сразу возвращаем ambiguous
 * с кандидатами ЭТОГО шага, не пытаясь "угадать получше" на следующем.
 */
export async function resolveProductByQuery(query: string): Promise<ProductResolution> {
  const q = normalize(query);
  if (!q) return { status: "not_found" };

  const bySlug = await prisma.product.findFirst({ where: { slug: q }, select: SELECT });
  if (bySlug) return { status: "found", product: bySlug };

  const allProducts = await prisma.product.findMany({ select: SELECT });

  const exactTitleMatches = allProducts.filter((p) => normalize(p.title) === q);
  if (exactTitleMatches.length === 1) return { status: "found", product: exactTitleMatches[0] };
  if (exactTitleMatches.length > 1) return { status: "ambiguous", candidates: exactTitleMatches };

  const partialMatches = allProducts.filter((p) => normalize(p.title).includes(q));
  if (partialMatches.length === 1) return { status: "found", product: partialMatches[0] };
  if (partialMatches.length > 1) return { status: "ambiguous", candidates: partialMatches };

  return { status: "not_found" };
}
