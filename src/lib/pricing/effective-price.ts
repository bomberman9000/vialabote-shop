// Единственная функция расчёта цены товара с учётом скидки. Используется
// одинаково в catalog/PDP/cart/checkout/order creation/admin preview/Telegram
// preview — никаких параллельных реализаций скидочной логики.
export interface DiscountInput {
  type: "percent" | "fixed";
  value: number; // percent: 1-100; fixed: копейки
  startsAt: Date | null;
  endsAt: Date | null;
}

export interface EffectivePriceResult {
  originalPrice: number; // копейки
  effectivePrice: number; // копейки — итог к оплате
  discountApplied: boolean;
  discountAmount: number; // копейки, 0 если скидка не действует
}

// Prisma хранит Discount.type как обычный String (SQLite не знает enum) —
// эта функция единственное место, где "сырой" Prisma-Discount конвертируется
// в узкий DiscountInput. Повреждённый/неизвестный type трактуется как
// "скидки нет" (а не падение) — валидный type гарантируется зодом в
// setDiscount на записи, так что это чисто defensive fallback на чтении.
export interface RawDiscount {
  type: string;
  value: number;
  startsAt: Date | null;
  endsAt: Date | null;
}

export function toDiscountInput(discount: RawDiscount | null | undefined): DiscountInput | null {
  if (!discount) return null;
  if (discount.type !== "percent" && discount.type !== "fixed") return null;
  return {
    type: discount.type,
    value: discount.value,
    startsAt: discount.startsAt,
    endsAt: discount.endsAt,
  };
}

/**
 * Скидка участвует в расчёте только если сейчас находится в [startsAt, endsAt]
 * (границы включительны, null = без ограничения с этой стороны). После endsAt
 * скидка автоматически перестаёт применяться — без ручного выключения.
 */
export function effectivePrice(
  price: number,
  discount: DiscountInput | null | undefined,
  now: Date = new Date(),
): EffectivePriceResult {
  if (!discount) {
    return { originalPrice: price, effectivePrice: price, discountApplied: false, discountAmount: 0 };
  }

  const started = discount.startsAt === null || discount.startsAt.getTime() <= now.getTime();
  const notEnded = discount.endsAt === null || discount.endsAt.getTime() >= now.getTime();
  const isActive = started && notEnded;

  if (!isActive) {
    return { originalPrice: price, effectivePrice: price, discountApplied: false, discountAmount: 0 };
  }

  let discounted: number;
  if (discount.type === "percent") {
    const clampedPercent = Math.min(100, Math.max(0, discount.value));
    discounted = Math.round(price * (1 - clampedPercent / 100));
  } else {
    discounted = price - discount.value;
  }
  discounted = Math.max(0, Math.min(price, discounted)); // скидка не может уйти в минус или превысить цену

  return {
    originalPrice: price,
    effectivePrice: discounted,
    discountApplied: discounted < price,
    discountAmount: price - discounted,
  };
}
