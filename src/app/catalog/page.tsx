import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ProductCard, ProductGrid } from "@/components/product-card";
import { concernTitle } from "@/lib/concerns";
import { resolveDisplayPrice } from "@/lib/pricing/product-price";
import { SortSelect } from "./sort-select";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: { concern?: string };
}): Promise<Metadata> {
  // Потребность резолвится по БД, а не по статическому списку: неизвестный
  // слаг в query даёт обычный заголовок каталога, как и раньше.
  const concern = searchParams.concern
    ? await prisma.concern.findUnique({ where: { slug: searchParams.concern } })
    : null;
  return {
    title: concern ? `${concernTitle(concern)} — Каталог Via Labote` : "Каталог — Via Labote",
    // Отфильтрованные/отсортированные вариации каталога не индексируем отдельно —
    // избегаем дублей и бесконечного crawl-space на query-параметрах.
    alternates: { canonical: "/catalog" },
  };
}

// Только реально поддерживаемые варианты сортировки — оба backend-поля
// (price, createdAt) существуют в модели, ничего не эмулируется.
const SORT_OPTIONS = [
  { value: "new", label: "Новинки", orderBy: { createdAt: "desc" as const } },
  { value: "price-asc", label: "Цена ↑", orderBy: { price: "asc" as const } },
  { value: "price-desc", label: "Цена ↓", orderBy: { price: "desc" as const } },
];

function buildHref(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) qs.set(key, value);
  }
  const query = qs.toString();
  return query ? `/catalog?${query}` : "/catalog";
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: { category?: string; concern?: string; sort?: string };
}) {
  const [categories, concerns] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.concern.findMany({ orderBy: { name: "asc" } }),
  ]);
  const concern = concerns.find((c) => c.slug === searchParams.concern);
  const sort = SORT_OPTIONS.find((s) => s.value === searchParams.sort) ?? SORT_OPTIONS[0];

  const where: Prisma.ProductWhereInput = {
    isActive: true,
    ...(searchParams.category ? { category: { slug: searchParams.category } } : {}),
    // Фильтр по потребности идёт через связь ProductConcern, а не через
    // захардкоженный список слагов: товар, размеченный в админке/Telegram,
    // попадает сюда сам, архивированный — уходит вместе с isActive.
    ...(concern ? { concerns: { some: { concern: { slug: concern.slug } } } } : {}),
  };

  // Сортировка по цене — по effective price (с учётом скидки), а не по
  // сырому Product.price, иначе порядок в UI разойдётся с тем, что реально
  // показано. Сортируем в памяти после расчёта displayPrice для каждого
  // товара (каталог не настолько велик, чтобы это было проблемой).
  const rawProducts = await prisma.product.findMany({
    where,
    orderBy: sort.value === "new" ? sort.orderBy : { createdAt: "desc" },
    include: { discount: true },
  });
  const products = rawProducts
    .map((p) => ({ product: p, displayPrice: resolveDisplayPrice(p) }))
    .sort((a, b) => {
      if (sort.value === "price-asc") return a.displayPrice.price - b.displayPrice.price;
      if (sort.value === "price-desc") return b.displayPrice.price - a.displayPrice.price;
      return 0; // "new" — порядок уже задан orderBy выше
    });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl text-brand-800">
          {concern ? concernTitle(concern) : "Каталог"}
        </h1>
        <p className="mt-1 text-sm text-brand-500">
          Найдено {products.length} {products.length === 1 ? "товар" : "товара"}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          <a
            href={buildHref({ sort: searchParams.sort })}
            className={`btn-outline ${!searchParams.category && !concern ? "bg-brand-100" : ""}`}
          >
            Все товары
          </a>
          {categories.map((c) => (
            <a
              key={c.id}
              href={buildHref({ category: c.slug, sort: searchParams.sort })}
              className={`btn-outline ${searchParams.category === c.slug ? "bg-brand-100" : ""}`}
            >
              {c.name}
            </a>
          ))}
          <span className="mx-1 w-px self-stretch bg-brand-200" aria-hidden="true" />
          {concerns.map((c) => (
            <a
              key={c.id}
              href={buildHref({ concern: c.slug, sort: searchParams.sort })}
              className={`btn-outline text-xs ${searchParams.concern === c.slug ? "bg-brand-100" : ""}`}
            >
              {concernTitle(c)}
            </a>
          ))}
        </div>

        <SortSelect current={sort.value} />
      </div>

      {products.length === 0 ? (
        <p className="text-brand-500">По этому фильтру пока нет товаров.</p>
      ) : (
        <ProductGrid>
          {products.map(({ product: p, displayPrice }) => (
            <ProductCard
              key={p.id}
              product={{
                id: p.id,
                slug: p.slug,
                title: p.title,
                subtitle: p.subtitle,
                badge: p.badge,
                price: displayPrice.price,
                oldPrice: displayPrice.compareAtPrice,
                imageUrl: p.imageUrl,
                stock: p.stock,
              }}
            />
          ))}
        </ProductGrid>
      )}
    </div>
  );
}
