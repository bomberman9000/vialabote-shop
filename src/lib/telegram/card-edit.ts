// Редактирование карточки товара из бота: поля, проверка ввода, предпросмотр — чистые функции.
// Запись идёт через существующие команды (updateProduct/setPrice/publish…), здесь только подготовка.
export const CARD_FIELDS = ["title", "price", "desc", "inci", "photo", "vis"] as const;
export type CardField = (typeof CARD_FIELDS)[number];
export const TEXT_FIELDS = ["title", "price", "desc", "inci"] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

export const FIELD_LABEL: Record<CardField, string> = {
  title: "Название",
  price: "Цена",
  desc: "Описание",
  inci: "Состав INCI",
  photo: "Фото",
  vis: "Видимость на сайте",
};
export const FIELD_PROMPT: Record<TextField, string> = {
  title: "Отправьте новое название (2–200 символов).",
  price: "Отправьте новую цену в рублях, например 2190 или 2190.50.",
  desc: "Отправьте новое описание (до 5000 символов).",
  inci: "Отправьте состав INCI одним сообщением (до 2000 символов).",
};

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
  if (field === "title") {
    if (v.length < 2 || v.length > 200) return { ok: false, error: "Название — от 2 до 200 символов." };
    return { ok: true, value: v };
  }
  if (field === "desc") {
    if (v.length > 5000) return { ok: false, error: "Описание — не длиннее 5000 символов." };
    return { ok: true, value: v };
  }
  if (v.length < 2 || v.length > 2000) return { ok: false, error: "Состав INCI — от 2 до 2000 символов." };
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
  status: string;
}

/** Предпросмотр «было → станет» для текстовых полей. money — formatPrice. */
export function cardPreview(field: TextField, product: CardSnapshot, value: string | number, money: (k: number) => string): string {
  const head = `Изменить «${product.title}» — ${FIELD_LABEL[field].toLowerCase()}`;
  switch (field) {
    case "title":
      return `${head}\nбыло: ${product.title}\nстанет: ${value}`;
    case "price":
      return `${head}\nбыло: ${money(product.price)}\nстанет: ${money(Number(value))}`;
    case "desc":
      return `${head}\nбыло: ${clip(product.description)}\nстанет: ${clip(String(value))}`;
    case "inci":
      return `${head}\nбыло: ${clip(product.activeIngredients ?? "")}\nстанет: ${clip(String(value))}`;
  }
}

export function visibilityPreview(title: string, from: string, to: Visibility): string {
  const fromRu = (VISIBILITY_RU as Record<string, string>)[from] ?? from;
  return `Видимость «${title}»\nбыло: ${fromRu}\nстанет: ${VISIBILITY_RU[to]}`;
}
