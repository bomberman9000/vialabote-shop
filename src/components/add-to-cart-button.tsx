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
      <button className="btn-outline w-fit" disabled>
        Нет в наличии
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center rounded-full border border-brand-200">
        <button
          type="button"
          aria-label="Уменьшить количество"
          className="flex h-10 w-10 items-center justify-center text-lg text-brand-700 hover:text-brand-900 disabled:opacity-30"
          disabled={quantity <= 1}
          onClick={() => setQuantity((q) => Math.max(1, q - 1))}
        >
          −
        </button>
        <span className="w-8 text-center text-sm font-medium text-brand-800">{quantity}</span>
        <button
          type="button"
          aria-label="Увеличить количество"
          className="flex h-10 w-10 items-center justify-center text-lg text-brand-700 hover:text-brand-900 disabled:opacity-30"
          disabled={quantity >= product.stock}
          onClick={() => setQuantity((q) => Math.min(product.stock, q + 1))}
        >
          +
        </button>
      </div>
      <button
        className="btn-primary"
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
