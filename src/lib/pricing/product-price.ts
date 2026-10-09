// Единая точка "какую цену показать на витрине" — обёртка над
// effectivePrice() для UI (catalog/PDP/cart/routine finder). Совмещает две
// независимые вещи, существующие в схеме:
//  - Product.oldPrice — статичное "было" поле, выставляется вручную при
//    создании товара, не имеет даты истечения;
//  - Discount — динамическая, датированная скидка через Admin Control Plane.
// Discount, если активна, ВСЕГДА имеет приоритет над статичным oldPrice —
// это единственное правило, которое видит UI; сам расчёт целиком в
// effectivePrice().
import { effectivePrice, toDiscountInput, type RawDiscount } from "./effective-price";

export interface DisplayPriceInput {
  price: number;
  oldPrice: number | null;
  discount: RawDiscount | null;
}

export interface DisplayPrice {
  price: number; // копейки — что показывать как основную цену
  compareAtPrice: number | null; // копейки — зачёркнутая "была" цена, если есть
  discountApplied: boolean;
}

export function resolveDisplayPrice(product: DisplayPriceInput, now: Date = new Date()): DisplayPrice {
  const discount = toDiscountInput(product.discount);
  const result = effectivePrice(product.price, discount, now);

  if (result.discountApplied) {
    return { price: result.effectivePrice, compareAtPrice: result.originalPrice, discountApplied: true };
  }

  if (product.oldPrice && product.oldPrice > product.price) {
    return { price: product.price, compareAtPrice: product.oldPrice, discountApplied: false };
  }

  return { price: product.price, compareAtPrice: null, discountApplied: false };
}
