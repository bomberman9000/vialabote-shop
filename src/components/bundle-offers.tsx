"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Plus, ShoppingBag } from "lucide-react";
import { useCart } from "@/lib/cart-context";
import { formatPrice } from "@/lib/money";

export interface BundleOfferItem {
  productId: string;
  slug: string;
  title: string;
  price: number;
  imageUrl: string;
  stock: number;
}

export interface BundleOffer {
  id: string;
  title: string;
  subtitle: string;
  percent: number;
  items: BundleOfferItem[];
  /** скидка в копейках — та же, что посчитает корзина и сервер (src/lib/bundles.ts) */
  discount: number;
}

/** Карточки наборов на главной: оба товара, старая и новая цена, «Добавить набор» кладёт всё сразу. */
export function BundleOffers({ offers }: { offers: BundleOffer[] }) {
  const { addItem } = useCart();
  const [added, setAdded] = useState<string | null>(null);
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {offers.map((o) => {
        const full = o.items.reduce((s, i) => s + i.price, 0);
        const inStock = o.items.every((i) => i.stock > 0);
        return (
          <article key={o.id} className="card flex flex-col gap-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-brand-900">Набор «{o.title}»</h3>
              <span className="shrink-0 rounded-full bg-gold-400 px-2.5 py-1 text-xs font-bold text-brand-900">−{o.percent}%</span>
            </div>
            <div className="flex items-center justify-center gap-2 rounded-xl bg-[#f3eee4] p-3">
              {o.items.map((i, k) => (
                <div key={i.productId} className="flex items-center gap-2">
                  {k > 0 ? <Plus aria-hidden className="h-5 w-5 shrink-0 text-gold-500" /> : null}
                  <Link href={`/product/${i.slug}`} className="block" title={i.title}>
                    <Image src={i.imageUrl} alt={i.title} width={120} height={160} className="h-32 w-24 object-contain mix-blend-multiply sm:h-36 sm:w-28" />
                  </Link>
                </div>
              ))}
            </div>
            <ul className="flex flex-col gap-1 text-sm text-brand-700">
              {o.items.map((i) => (
                <li key={i.productId} className="flex justify-between gap-3">
                  <Link href={`/product/${i.slug}`} className="hover:underline">{i.title}</Link>
                  <span className="shrink-0 tabular-nums">{formatPrice(i.price)}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-brand-500">{o.subtitle}</p>
            <div className="mt-auto flex items-end justify-between gap-3">
              <div>
                <span className="block text-sm text-brand-400 line-through">{formatPrice(full)}</span>
                <span className="text-2xl font-bold tabular-nums text-brand-900">{formatPrice(full - o.discount)}</span>
                <span className="block text-xs font-medium text-emerald-700">экономия {formatPrice(o.discount)}</span>
              </div>
              <button
                type="button"
                className="btn-primary shrink-0 gap-2"
                disabled={!inStock}
                onClick={() => {
                  for (const i of o.items) addItem({ productId: i.productId, slug: i.slug, title: i.title, price: i.price, imageUrl: i.imageUrl });
                  setAdded(o.id);
                  setTimeout(() => setAdded((cur) => (cur === o.id ? null : cur)), 2500);
                }}
              >
                <ShoppingBag aria-hidden className="h-4 w-4" />
                {!inStock ? "Нет в наличии" : added === o.id ? "В корзине ✓" : "Добавить набор"}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
