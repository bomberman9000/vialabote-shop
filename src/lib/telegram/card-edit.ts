// Редактирование карточки товара из бота: поля, проверка ввода, предпросмотр — чистые функции.
// Запись идёт через существующие команды (updateProduct/setPrice/publish…), здесь только подготовка.
export const CARD_FIELDS = ["title", "price", "desc", "inci", "howto", "warn", "shelf", "maker", "cat", "photo", "vis"] as const;
export type CardField = (typeof CARD_FIELDS)[number];
export const TEXT_FIELDS = ["title", "price", "desc", "inci", "howto", "warn", "shelf", "maker"] as const;
export type TextField = (typeof TEXT_FIELDS)[number];
/** Необязательные поля: «-» в ответ очищает значение. */
export const CLEARABLE_FIELDS: readonly TextField[] = ["inci", "howto", "warn", "shelf", "maker"];
export const CLEAR_MARK = "-";

/** Поле бота -> колонка Product (цена идёт отдельной командой setPrice). */
export const FIELD_COLUMN = {
  title: "title",
  desc: "description",
  inci: "activeIngredients",
  howto: "howToUse",
  warn: "warnings",
  shelf: "shelfLife",
  maker: "manufacturer",
} as const;
export type ColumnField = keyof typeof FIELD_COLUMN;

export const FIELD_LABEL: Record<CardField, string> = {
  title: "Название",
  price: "Цена",
  desc: "Описание",
  inci: "Состав INCI",
  howto: "Применение",
  warn: "Предупреждения",
  shelf: "Срок годности",
  maker: "Производитель",
  cat: "Категория",
  photo: "Фото",
  vis: "Публикация",
};
const CLEAR_HINT = ` Отправьте «${CLEAR_MARK}», чтобы очистить.`;
export const FIELD_PROMPT: Record<TextField, string> = {
  title: "Отправьте новое название (2–200 символов).",
  price: "Отправьте новую цену в рублях, например 2190 или 2190.50.",
  desc: "Отправьте новое описание (до 5000 символов).",
  inci: "Отправьте состав INCI одним сообщением (до 2000 символов)." + CLEAR_HINT,
  howto: "Отправьте способ применения: каждый шаг с новой строки (до 2000 символов)." + CLEAR_HINT,
  warn: "Отправьте предупреждения и противопоказания, каждый пункт с новой строки (до 2000 символов)." + CLEAR_HINT,
  shelf: "Отправьте срок годности, например «24 месяца, после вскрытия 12 месяцев» (до 100 символов)." + CLEAR_HINT,
  maker: "Отправьте производителя, например «ООО «БОТЭ», Россия» (до 200 символов)." + CLEAR_HINT,
};
const MAX_LEN: Record<Exclude<TextField, "price">, number> = { title: 200, desc: 5000, inci: 2000, howto: 2000, warn: 2000, shelf: 100, maker: 200 };

export function isTextField(v: string): v is TextField {
  return (TEXT_FIELDS as readonly string[]).includes(v);
}
export function isCardField(v: string): v is CardField {
  return (CARD_FIELDS as readonly string[]).includes(v);
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** «2190», «2 190,50», «2190₽» -> копейки. Ноль и отрицательные отклоняются. */
export function parsePriceRubles(text: string): Parsed<number> {
  const t = text.trim().replace(/[\s ]/g, "").replace(/(?:₽|руб\.?|р\.?)$/i, "").replace(",", ".");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return { ok: false, error: "Цена — число в рублях, например 2190 или 2190.50." };
  const kopecks = Math.round(Number(t) * 100);
  if (kopecks <= 0) return { ok: false, error: "Цена должна быть больше нуля." };
  return { ok: true, value: kopecks };
}

/** Проверка текстовых полей теми же границами, что у updateProductSchema. */
export function parseTextField(field: TextField, text: string): Parsed<string | number> {
  const v = text.trim();
  if (field === "price") return parsePriceRubles(v);
  if (v === CLEAR_MARK && CLEARABLE_FIELDS.includes(field)) return { ok: true, value: "" };
  const max = MAX_LEN[field];
  if (field === "title" && v.length < 2) return { ok: false, error: "Название — от 2 до 200 символов." };
  if (field !== "title" && field !== "desc" && v.length < 2) return { ok: false, error: `${FIELD_LABEL[field]} — минимум 2 символа.` };
  if (v.length > max) return { ok: false, error: `${FIELD_LABEL[field]} — не длиннее ${max} символов.` };
  return { ok: true, value: v };
}

export const VISIBILITY = ["published", "draft", "archived"] as const;
export type Visibility = (typeof VISIBILITY)[number];
export const VISIBILITY_RU: Record<Visibility, string> = {
  published: "виден на сайте",
  draft: "скрыт (черновик)",
  archived: "в архиве",
};
export function isVisibility(v: string): v is Visibility {
  return (VISIBILITY as readonly string[]).includes(v);
}

const clip = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}…` : s || "—");

export interface CardSnapshot {
  title: string;
  price: number;
  description: string;
  activeIngredients: string | null;
  howToUse?: string | null;
  warnings?: string | null;
  shelfLife?: string | null;
  manufacturer?: string | null;
  status: string;
}

/** Предпросмотр «было → станет» для текстовых полей. money — formatPrice. */
export function cardPreview(field: TextField, product: CardSnapshot, value: string | number, money: (k: number) => string): string {
  const head = `Изменить «${product.title}» — ${FIELD_LABEL[field].toLowerCase()}`;
  if (field === "price") return `${head}\nбыло: ${money(product.price)}\nстанет: ${money(Number(value))}`;
  if (field === "title") return `${head}\nбыло: ${product.title}\nстанет: ${value}`;
  const was = (product as unknown as Record<string, string | null | undefined>)[FIELD_COLUMN[field]] ?? "";
  return `${head}\nбыло: ${clip(was)}\nстанет: ${value === "" ? "— (очистить)" : clip(String(value))}`;
}

export function categoryPreview(title: string, from: string, to: string): string {
  return `Категория «${title}»\nбыло: ${from}\nстанет: ${to}`;
}

export function visibilityPreview(title: string, from: string, to: Visibility): string {
  const fromRu = (VISIBILITY_RU as Record<string, string>)[from] ?? from;
  return `Видимость «${title}»\nбыло: ${fromRu}\nстанет: ${VISIBILITY_RU[to]}`;
}
