"use client";

import { Truck } from "lucide-react";
import { useCart } from "@/lib/cart-context";
import { useCartTotals } from "@/lib/use-cart-totals";
import { formatPrice } from "@/lib/money";
import { FREE_DELIVERY_FROM_KOPECKS } from "@/lib/delivery/free-delivery";

/** «Ещё N ₽ — и доставка бесплатно» с полоской: в корзине и на карточке товара. Пустая корзина — ничего. */
export function FreeDeliveryProgress({ className = "" }: { className?: string }) {
  const { items } = useCart();
  const { goodsAmount: totalAmount } = useCartTotals();
  if (items.length === 0) return null;
  const left = FREE_DELIVERY_FROM_KOPECKS - totalAmount;
  const pct = Math.min(100, Math.round((totalAmount / FREE_DELIVERY_FROM_KOPECKS) * 100));
  return (
    <div className={`flex w-full flex-col gap-1.5 text-sm ${className}`} aria-live="polite">
      <p className="inline-flex items-center gap-2 text-brand-700">
        <Truck size={16} strokeWidth={1.6} aria-hidden="true" className="shrink-0 text-gold-500" />
        {left > 0 ? (
          <span>
            Ещё <b className="text-brand-900">{formatPrice(left)}</b> — и доставка в пункт Ozon бесплатно
          </span>
        ) : (
          <span className="font-medium text-emerald-700">Доставка в пункт Ozon — бесплатно</span>
        )}
      </p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-brand-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className={`h-full rounded-full ${left > 0 ? "bg-gold-400" : "bg-emerald-600"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
