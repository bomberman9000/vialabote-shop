"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart-context";

interface Props {
  product: {
    id: string;
    slug: string;
    title: string;
    price: number;
    imageUrl: string;
    stock: number;
  };
}

export function AddToCartButton({ product }: Props) {
  const { addItem } = useCart();
  const router = useRouter();
  const [quantity, setQuantity] = useState(1);

  if (product.stock <= 0) {
    return (
      <button
        className="inline-flex min-h-12 w-full items-center justify-center rounded-full border border-brand-200 px-8 text-xs font-bold uppercase tracking-[0.1em] text-brand-400 sm:w-fit"
        disabled
      >
        Нет в наличии
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
      <div className="flex shrink-0 items-center rounded-full border border-brand-200">
        <button
          type="button"
          aria-label="Уменьшить количество"
          className="flex h-12 w-12 items-center justify-center rounded-full text-lg text-brand-700 transition-colors hover:bg-white hover:text-brand-900 disabled:opacity-30"
          disabled={quantity <= 1}
          onClick={() => setQuantity((q) => Math.max(1, q - 1))}
        >
          −
        </button>
        <span className="w-8 text-center text-sm font-bold tabular-nums text-brand-900" aria-live="polite">{quantity}</span>
        <button
          type="button"
          aria-label="Увеличить количество"
          className="flex h-12 w-12 items-center justify-center rounded-full text-lg text-brand-700 transition-colors hover:bg-white hover:text-brand-900 disabled:opacity-30"
          disabled={quantity >= product.stock}
          onClick={() => setQuantity((q) => Math.min(product.stock, q + 1))}
        >
          +
        </button>
      </div>
      <button
        className="inline-flex min-h-12 flex-1 items-center justify-center rounded-full bg-brand-900 px-8 text-xs font-bold uppercase tracking-[0.1em] text-white transition-colors duration-200 hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 sm:flex-none"
        onClick={() => {
          addItem(
            {
              productId: product.id,
              slug: product.slug,
              title: product.title,
              price: product.price,
              imageUrl: product.imageUrl,
            },
            quantity,
          );
          router.push("/cart");
        }}
      >
        Добавить в корзину
      </button>
    </div>
  );
}
