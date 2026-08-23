"use client";

import Link from "next/link";
import Image from "next/image";
import { formatPrice } from "@/lib/money";
import { useCart } from "@/lib/cart-context";

export interface ProductCardData {
  id: string;
  slug: string;
  title: string;
  subtitle?: string | null;
  badge?: string | null;
  price: number;
  oldPrice: number | null;
  imageUrl: string;
  stock: number;
}

export function ProductCard({ product }: { product: ProductCardData }) {
  const { addItem } = useCart();

  return (
    <div className="card flex flex-col overflow-hidden">
      <Link
        href={`/product/${product.slug}`}
        className="relative block aspect-square bg-brand-50"
      >
        <Image
          src={product.imageUrl}
          alt={product.title}
          fill
          className="object-contain p-6"
          sizes="300px"
        />
        {product.badge ? (
          <span className="absolute left-3 top-3 rounded-full bg-gold-400 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-brand-900">
            {product.badge}
          </span>
        ) : null}
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <Link href={`/product/${product.slug}`} className="font-medium text-brand-800 hover:underline">
          {product.title}
        </Link>
        {product.subtitle ? <p className="text-xs text-brand-500">{product.subtitle}</p> : null}
        <div className="mt-auto flex items-center justify-between pt-2">
          <div>
            <span className="font-semibold text-brand-800">{formatPrice(product.price)}</span>
            {product.oldPrice ? (
              <span className="ml-2 text-xs text-brand-400 line-through">
                {formatPrice(product.oldPrice)}
              </span>
            ) : null}
          </div>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-900 text-gold-200 transition-colors hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-brand-200 disabled:text-brand-400"
            disabled={product.stock <= 0}
            aria-label={product.stock > 0 ? `Добавить «${product.title}» в корзину` : "Нет в наличии"}
            title={product.stock > 0 ? "В корзину" : "Нет в наличии"}
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
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
