// Клиентский поиск по витрине. Индекс строится на сервере из того же
// источника товаров (Prisma, только опубликованные), поэтому новый/изменённый
// через админку или Telegram товар попадает в поиск без правок кода.

export interface SearchProduct {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  price: number;
  oldPrice: number | null;
  /** нормализованный текст: название, назначение, состав, категория, потребности */
  haystack: string;
}

export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Все слова запроса должны встретиться (как начало слова в тексте товара);
 * совпадение в названии весит больше, чем в составе/описании.
 */
export function searchProducts(products: SearchProduct[], query: string, limit = 8): SearchProduct[] {
  const tokens = normalizeSearchText(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return [];

  const scored: { product: SearchProduct; score: number }[] = [];
  for (const product of products) {
    const title = " " + normalizeSearchText(product.title);
    const hay = " " + product.haystack;
    let score = 0;
    let all = true;
    for (const token of tokens) {
      if (title.includes(" " + token)) score += 3;
      else if (hay.includes(" " + token)) score += 1;
      else {
        all = false;
        break;
      }
    }
    if (all) scored.push({ product, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.product.title.localeCompare(b.product.title, "ru"))
    .slice(0, limit)
    .map((s) => s.product);
}
