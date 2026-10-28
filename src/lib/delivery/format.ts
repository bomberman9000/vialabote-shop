// Показ срока доставки покупателю. Ozon отдаёт границу интервала в UTC, обычно полночь местного времени
// следующего дня (например, 21:00Z = 00:00 МСК). Минус минута и дата по Москве: для всех поясов восточнее
// Калининграда это точный день, для Калининграда — на день позже, но никогда не раньше реального срока.
export function formatDeliveryDate(iso: string | Date | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t - 60_000).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
}

const REASONS: Record<string, string> = {
  NOT_MAPPED: "Часть товаров пока нельзя отправить через Ozon",
  OUT_OF_STOCK: "Товара нет на складе Ozon",
  OUT_OF_STOCK_FBS: "Товара нет на складе Ozon",
  BANNED_FOR_AREA: "Ozon не доставляет этот заказ в выбранное место",
  DELIVERY_UNAVAILABLE: "Ozon не доставляет в выбранное место",
  INVALID_WEIGHT: "Заказ слишком тяжёлый для этого способа доставки",
};

/** Причина недоступности Ozon -> текст для покупателя. */
export function deliveryReasonText(reason: string | null | undefined): string {
  return (reason && REASONS[reason]) || "Доставка Ozon в выбранное место недоступна";
}
