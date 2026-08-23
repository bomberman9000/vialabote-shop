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
    <div className="flex items-center gap-3">
      <input
        type="number"
        min={1}
        max={product.stock}
        value={quantity}
        onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
        className="input w-20"
      />
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
        В корзину
      </button>
    </div>
  );
}
