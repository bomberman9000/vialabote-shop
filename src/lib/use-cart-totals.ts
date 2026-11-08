"use client";

import { useCart } from "@/lib/cart-context";
import { almostBundles, applyBundles } from "@/lib/bundles";

/** Сумма корзины со скидкой за наборы — как посчитает сервер. goodsAmount — для итога и порога бесплатной доставки. */
export function useCartTotals() {
  const { items, totalAmount } = useCart();
  const lines = items.map((i) => ({ slug: i.slug, price: i.price, quantity: i.quantity }));
  const { applied, discount } = applyBundles(lines);
  return { itemsAmount: totalAmount, bundleDiscount: discount, goodsAmount: totalAmount - discount, applied, almost: almostBundles(lines) };
}
