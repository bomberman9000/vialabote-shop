// Поиск пункта Ozon по улице и дому («Свободы 2», «ул. Свободы, д. 2а», «пр-т Кирова») по тексту адреса
// из карточки пункта (point/info). Без геокодера: адрес покупателя никуда не отправляется.

/** Слова-типы улиц и домов: в запросе их можно писать как угодно, при сравнении они не учитываются. */
const SKIP = new Set([
  "улица", "ул", "проспект", "пр", "прт", "пркт", "переулок", "пер", "шоссе", "ш", "бульвар", "бр", "бул",
  "площадь", "пл", "проезд", "прд", "набережная", "наб", "тупик", "аллея", "дом", "д", "корпус", "корп", "к",
  "строение", "стр", "г", "город",
]);

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/(^|[\s,])(пр|б)-(т|р|д)(?=[\s,.]|$)/g, "$1$2$3") // «пр-т», «б-р», «пр-д» — одним словом
    .split(/[^0-9a-zа-я]+/)
    .filter(Boolean);
}

/** Значимые слова запроса (без «ул.», «д.» и т. п.). Пусто — искать нечего. */
export function streetQueryTokens(query: string): string[] {
  return words(query).filter((w) => !SKIP.has(w));
}

/**
 * Подходит ли адрес под запрос: каждое значимое слово запроса есть в адресе.
 * Название — по началу слова без последней буквы («свобода» найдёт «Свободы»);
 * номер дома — целиком, литера после него допустима («2» найдёт «2А», но не «20»).
 */
export function matchesAddress(address: string, query: string): boolean {
  const tokens = streetQueryTokens(query);
  if (tokens.length === 0) return false;
  const addr = words(address);
  return tokens.every((t) => {
    if (/^\d/.test(t)) return addr.some((w) => w === t || (w.startsWith(t) && /^[a-zа-я]/.test(w.slice(t.length))));
    const stem = t.length > 4 ? t.slice(0, -1) : t;
    return addr.some((w) => w.startsWith(stem));
  });
}
