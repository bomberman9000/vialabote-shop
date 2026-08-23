"use client";

import Link from "next/link";
import Image from "next/image";
import { formatPrice } from "@/lib/money";
import { useCart } from "@/lib/cart-context";

export interface ProductCardData {
  id: string;
  slug: string;
  title: string;
  price: number;
  oldPrice: number | null;
  imageUrl: string;
  stock: number;
}

export function ProductCard({ product }: { product: ProductCardData }) {
  const { addItem } = useCart();

  return (
    <div className="card flex flex-col overflow-hidden">
      <Link href={`/product/${product.slug}`} className="relative block aspect-square bg-brand-100">
        <Image src={product.imageUrl} alt={product.title} fill className="object-cover" sizes="300px" />
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <Link href={`/product/${product.slug}`} className="font-medium text-brand-800 hover:underline">
          {product.title}
        </Link>
        <div className="mt-auto flex items-center justify-between">
          <div>
            <span className="font-semibold text-brand-800">{formatPrice(product.price)}</span>
            {product.oldPrice ? (
              <span className="ml-2 text-xs text-brand-400 line-through">
                {formatPrice(product.oldPrice)}
              </span>
            ) : null}
          </div>
        </div>
        <button
          className="btn-outline mt-2"
          disabled={product.stock <= 0}
          onClick={() =>
            addItem({
              productId: product.id,
              slug: product.slug,
              title: product.title,
              price: product.price,
              imageUrl: product.imageUrl,
            })
          }
        >
          {product.stock > 0 ? "В корзину" : "Нет в наличии"}
        </button>
      </div>
    </div>
  );
}
