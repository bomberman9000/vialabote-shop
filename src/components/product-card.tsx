"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Check, ShoppingBag } from "lucide-react";
import { formatPrice } from "@/lib/money";
import { useCart } from "@/lib/cart-context";
import type { ProductCardData } from "@/lib/product-card-data";

export type { ProductCardData };

// Единая товарная карточка витрины: главная, каталог, «Дополните уход».
// Всё, что видно, — из данных товара (title/subtitle/badge/цены/фото/stock):
// карточка не знает ни одного конкретного SKU, поэтому товар, созданный в
// админке или через Telegram, отображается так же.
//
// Фото: единая область 3:4 на молочном фоне, object-contain — снимок никогда
// не обрезается и не растягивается; совпадающие по пропорции снимки
// заполняют её целиком, остальные встают по центру с полями.
// Вся карточка ведёт на товар (растянутая ссылка заголовка), кнопка корзины
// лежит поверх неё отдельным слоем.
export function ProductCard({ product }: { product: ProductCardData }) {
  const { addItem } = useCart();
  const [added, setAdded] = useState(false);
  const inStock = product.stock > 0;
  const href = `/product/${product.slug}`;

  function handleAdd() {
    addItem({
      productId: product.id,
      slug: product.slug,
      title: product.title,
      price: product.price,
      imageUrl: product.imageUrl,
    });
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1600);
  }

  return (
    <article className="group relative flex h-full flex-col">
      <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-[#F1EADF] transition-shadow duration-300 group-hover:shadow-[0_18px_40px_-24px_rgba(16,21,44,0.45)]">
        <Image
          src={product.imageUrl}
          alt=""
          fill
          className="object-contain transition-transform duration-500 ease-out group-hover:scale-[1.03]"
          sizes="(min-width: 1280px) 300px, (min-width: 768px) 33vw, 50vw"
        />
        {product.badge ? (
          <span className="absolute left-3 top-3 rounded-full bg-[#FAF6EE]/95 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-brand-900 sm:text-[11px]">
            {product.badge}
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 pt-4">
        <h3 className="line-clamp-2 text-[15px] font-bold leading-snug text-brand-900 sm:text-base">
          <Link
            href={href}
            className="outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-gold-400 focus-visible:after:ring-offset-4 focus-visible:after:ring-offset-[#FAF6EE]"
          >
            {product.title}
          </Link>
        </h3>
        {product.subtitle ? (
          <p className="line-clamp-2 text-[13px] leading-snug text-brand-500">{product.subtitle}</p>
        ) : null}

        <div className="mt-auto flex flex-col gap-3 pt-3">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-base font-bold text-brand-900 sm:text-lg">{formatPrice(product.price)}</span>
            {product.oldPrice && product.oldPrice > product.price ? (
              <span className="text-sm text-brand-400 line-through">
                <span className="sr-only">Старая цена: </span>
                {formatPrice(product.oldPrice)}
              </span>
            ) : null}
          </p>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!inStock}
            aria-label={inStock ? `Добавить «${product.title}» в корзину` : `«${product.title}» нет в наличии`}
            className="relative z-10 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-brand-900 px-4 text-xs font-bold uppercase tracking-[0.08em] text-brand-900 transition-colors hover:bg-brand-900 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF6EE] disabled:cursor-not-allowed disabled:border-brand-200 disabled:text-brand-400 disabled:hover:bg-transparent"
          >
            {!inStock ? (
              "Нет в наличии"
            ) : added ? (
              <>
                <Check size={15} strokeWidth={2} aria-hidden="true" />
                Добавлено
              </>
            ) : (
              <>
                <ShoppingBag size={15} strokeWidth={1.8} aria-hidden="true" />В корзину
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}

// Сетка товарных карточек — одна на всю витрину, чтобы главная, каталог и
// рекомендации не расходились по колонкам и отступам. На телефоне всегда
// 2 колонки: карточка остаётся читаемой без зума.
// columns={3} — для коротких подборок (главная): ряд остаётся полным там,
// где 4 колонки оставили бы «висящий» неполный ряд.
export function ProductGrid({ children, columns = 4 }: { children: React.ReactNode; columns?: 3 | 4 }) {
  return (
    <div
      className={`grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 md:grid-cols-3 ${columns === 4 ? "xl:grid-cols-4" : "lg:gap-x-8"}`}
    >
      {children}
    </div>
  );
}
