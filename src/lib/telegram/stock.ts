// Логика остатков — чистые функции (без БД): разбор ввода, кнопки +/-, предпросмотр.
export const MAX_STOCK = 100_000;
export const STOCK_STEPS = [-10, -1, 1, 10] as const;

export function clampStock(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_STOCK, Math.max(0, Math.trunc(n)));
}

/** Кнопка ±step от черновика; не уходит ниже 0 и выше MAX_STOCK. */
export function applyStep(draft: number, step: number): number {
  return clampStock(draft + step);
}

export type StockInput = { ok: true; value: number } | { ok: false; error: string };

/**
 * Ввод числа в чат: «12» или «=12» — выставить; «+5» / «-3» — изменить относительно текущего.
 * Отрицательный итог, дроби, текст и значения выше MAX_STOCK отклоняются, а не обрезаются молча.
 */
export function parseStockInput(text: string, current: number): StockInput {
  const t = text.trim().replace(/\s+/g, "").replace(/шт\.?$/i, "");
  const m = /^([+\-=]?)(\d{1,7})$/.exec(t);
  if (!m) return { ok: false, error: "Введите целое число: 12 — выставить, +5 или -3 — изменить." };
  const n = Number(m[2]);
  const value = m[1] === "+" ? current + n : m[1] === "-" ? current - n : n;
  if (value < 0) return { ok: false, error: `Остаток не может быть отрицательным (сейчас ${current}).` };
  if (value > MAX_STOCK) return { ok: false, error: `Слишком много: максимум ${MAX_STOCK}.` };
  return { ok: true, value };
}

export function stockPreview(title: string, was: number, now: number): string {
  const delta = now - was;
  return `Остаток «${title}»\nбыло: ${was} шт.\nстанет: ${now} шт. (${delta >= 0 ? "+" : ""}${delta})`;
}

export function stockEditorText(title: string, current: number, draft: number): string {
  const delta = draft - current;
  return [
    `📉 Остаток: ${title}`,
    `Сейчас в базе: ${current} шт.`,
    `Новое значение: ${draft} шт.${delta ? ` (${delta > 0 ? "+" : ""}${delta})` : " (без изменений)"}`,
    "",
    "Меняйте кнопками или нажмите «Ввести число». Запись — только после подтверждения.",
  ].join("\n");
}
