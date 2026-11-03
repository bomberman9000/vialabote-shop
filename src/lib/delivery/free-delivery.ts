// Бесплатная доставка от суммы товаров: покупатель за доставку не платит, тариф Ozon оплачивает магазин.
// Сумма товаров — уже с учётом скидок (то, что покупатель платит за товары).
export const FREE_DELIVERY_FROM_KOPECKS = 500_000;

/** Сколько за доставку платит покупатель: 0 от порога, иначе тариф Ozon. */
export function customerDeliveryPrice(goodsKopecks: number, ozonPriceKopecks: number): number {
  return goodsKopecks >= FREE_DELIVERY_FROM_KOPECKS ? 0 : ozonPriceKopecks;
}
