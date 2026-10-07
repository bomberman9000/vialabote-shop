"use client";

import Link from "next/link";
import Image from "next/image";
import { Minus, Plus, X } from "lucide-react";
import { useCart } from "@/lib/cart-context";
import { formatPrice } from "@/lib/money";

export default function CartPage() {
  const { items, removeItem, setQuantity, totalAmount } = useCart();

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-lg text-brand-600">Корзина пуста</p>
        <Link href="/catalog" className="btn-primary">
          Перейти в каталог
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-brand-800">Корзина</h1>

      <div className="flex flex-col gap-4">
        {items.map((item) => (
          // Строка корзины — та же визуальная система, что у ProductCard: фото
          // 3:4 на молочном фоне (contain), без растягивания. На телефоне
          // количество/сумма уходят второй строкой на всю ширину,
          // кнопки ±/удалить — 44px.
          <div key={item.productId} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-6">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <Link
                href={`/product/${item.slug}`}
                tabIndex={-1}
                aria-hidden="true"
                className="relative aspect-[3/4] w-20 shrink-0 overflow-hidden rounded-xl bg-[#F1EADF] sm:w-24"
              >
                <Image src={item.imageUrl} alt="" fill className="object-contain" sizes="96px" />
              </Link>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/product/${item.slug}`}
                  className="line-clamp-2 font-bold leading-snug text-brand-900 hover:underline"
                >
                  {item.title}
                </Link>
                <p className="mt-1 text-sm text-brand-500">{formatPrice(item.price)} / шт.</p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 sm:justify-end sm:gap-6">
                <div className="inline-flex items-center rounded-full border border-brand-200">
                  <button
                    type="button"
                    onClick={() => setQuantity(item.productId, item.quantity - 1)}
                    disabled={item.quantity <= 1}
                    aria-label={`Уменьшить количество «${item.title}»`}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-brand-200"
                  >
                    <Minus size={15} strokeWidth={2} aria-hidden="true" />
                  </button>
                  <span className="w-7 text-center text-sm font-bold tabular-nums text-brand-900" aria-live="polite">
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQuantity(item.productId, item.quantity + 1)}
                    aria-label={`Увеличить количество «${item.title}»`}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-brand-700 hover:bg-brand-50"
                  >
                    <Plus size={15} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
                <span className="min-w-[5.5rem] text-right font-bold tabular-nums text-brand-900">
                  {formatPrice(item.price * item.quantity)}
                </span>
                <button
                  type="button"
                  onClick={() => removeItem(item.productId)}
                  aria-label={`Удалить «${item.title}» из корзины`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-brand-400 hover:bg-red-50 hover:text-red-500"
                >
                  <X size={18} strokeWidth={1.8} aria-hidden="true" />
                </button>
            </div>
          </div>
        ))}
      </div>

      <div className="card flex flex-col items-end gap-3 p-6">
        <p className="text-lg">
          Итого: <span className="font-semibold text-brand-800">{formatPrice(totalAmount)}</span>
        </p>
        <Link href="/checkout" className="btn-primary">
          Оформить заказ
        </Link>
      </div>
    </div>
  );
}
