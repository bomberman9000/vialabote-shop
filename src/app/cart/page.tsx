"use client";

import Link from "next/link";
import Image from "next/image";
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
          <div key={item.productId} className="card flex items-center gap-4 p-4">
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-brand-100">
              <Image src={item.imageUrl} alt={item.title} fill className="object-cover" sizes="80px" />
            </div>
            <div className="flex-1">
              <Link href={`/product/${item.slug}`} className="font-medium text-brand-800 hover:underline">
                {item.title}
              </Link>
              <p className="text-sm text-brand-500">{formatPrice(item.price)} / шт.</p>
            </div>
            <input
              type="number"
              min={1}
              value={item.quantity}
              onChange={(e) => setQuantity(item.productId, Number(e.target.value) || 1)}
              className="input w-20"
            />
            <span className="w-24 text-right font-medium text-brand-800">
              {formatPrice(item.price * item.quantity)}
            </span>
            <button
              onClick={() => removeItem(item.productId)}
              className="text-sm text-brand-400 hover:text-red-500"
            >
              Удалить
            </button>
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
