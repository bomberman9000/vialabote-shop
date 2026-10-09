// Детерминированный парсер операторских команд Telegram. НЕ LLM: строгие
// паттерны на фиксированный набор команд (owner decision — см. отчёт).
// text → typed intent proposal. Дальше: entity resolution → validation →
// authorization → confirmation → application service. Парсер сам НИЧЕГО
// не исполняет и не обращается к БД.

export type ParsedCommand =
  | { type: "SET_DISCOUNT"; productQuery: string; discountType: "percent" | "fixed"; value: number; endsAt: { day: number; month: number } | null }
  | { type: "SET_PRICE"; productQuery: string; price: number }
  | { type: "PUBLISH_PRODUCT"; productQuery: string }
  | { type: "ARCHIVE_PRODUCT"; productQuery: string }
  | { type: "LIST_PRODUCTS_MISSING_INCI" }
  | { type: "CREATE_BANNER"; placementQuery: string; endsAt: { day: number; month: number } | null }
  | { type: "AMBIGUOUS"; reason: string }
  | { type: "UNKNOWN" };

interface PatternDef {
  regex: RegExp;
  build: (match: RegExpMatchArray) => ParsedCommand;
}

function parseDate(day?: string, month?: string): { day: number; month: number } | null {
  if (!day || !month) return null;
  const d = Number(day);
  const m = Number(month);
  if (d < 1 || d > 31 || m < 1 || m > 12) return null;
  return { day: d, month: m };
}

// Порядок важен: более специфичные паттерны проверяются раньше более общих,
// чтобы избежать случайного двойного совпадения.
const PATTERNS: PatternDef[] = [
  {
    // "скидка Multi3 15% до 30.08"
    regex: /^скидк[аи]\s+(.+?)\s+(\d{1,3})\s*%(?:\s+до\s+(\d{1,2})\.(\d{1,2}))?\s*$/i,
    build: (m) => ({
      type: "SET_DISCOUNT",
      productQuery: m[1].trim(),
      discountType: "percent",
      value: Number(m[2]),
      endsAt: parseDate(m[3], m[4]),
    }),
  },
  {
    // "цена Retinal Serum 2190"
    regex: /^цена\s+(.+?)\s+(\d+)\s*(?:₽|руб)?\s*$/i,
    build: (m) => ({ type: "SET_PRICE", productQuery: m[1].trim(), price: Number(m[2]) }),
  },
  {
    // "показать товары без INCI" — конкретная read-команда, проверяем ДО общих "скрыть/показать"
    regex: /^(?:покажи|показать)\s+товары\s+без\s+inci\s*$/i,
    build: () => ({ type: "LIST_PRODUCTS_MISSING_INCI" }),
  },
  {
    // "скрыть Beard Oil" / "спрячь Beard Oil"
    regex: /^(?:скрыть|спрячь|архивировать)\s+(.+)$/i,
    build: (m) => ({ type: "ARCHIVE_PRODUCT", productQuery: m[1].trim() }),
  },
  {
    // "опубликовать Multi3" / "покажи Multi3" (в смысле "сделай видимым")
    regex: /^(?:опубликовать|опубликуй)\s+(.+)$/i,
    build: (m) => ({ type: "PUBLISH_PRODUCT", productQuery: m[1].trim() }),
  },
  {
    // "баннер главная до 30.08"
    regex: /^баннер\s+(.+?)(?:\s+до\s+(\d{1,2})\.(\d{1,2}))?\s*$/i,
    build: (m) => ({ type: "CREATE_BANNER", placementQuery: m[1].trim(), endsAt: parseDate(m[2], m[3]) }),
  },
];

export function parseCommand(rawText: string): ParsedCommand {
  const text = rawText.trim();
  if (!text) return { type: "UNKNOWN" };

  const matches = PATTERNS.map((p) => ({ pattern: p, match: text.match(p.regex) })).filter(
    (r) => r.match !== null,
  );

  if (matches.length === 0) return { type: "UNKNOWN" };

  if (matches.length > 1) {
    // Больше одного паттерна совпало — не угадываем, какой имелся в виду.
    return { type: "AMBIGUOUS", reason: "Текст совпадает с несколькими типами команд" };
  }

  const { pattern, match } = matches[0];
  return pattern.build(match!);
}
