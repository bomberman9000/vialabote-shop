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
    // Только категории, в которых есть опубликованный товар: категория из
    // одних черновиков не даёт фильтр-ссылку на пустую выдачу.
    prisma.category.findMany({
      where: { products: { some: { isActive: true } } },
      orderBy: { name: "asc" },
    }),
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
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2 pt-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-gold-500">
          {concern ? "Задача кожи" : "VIA LABOTE"}
        </p>
        <h1 className="text-[2rem] leading-tight text-brand-900 sm:text-[2.5rem]">
          {concern ? concernTitle(concern) : "Каталог"}
        </h1>
        <p className="text-sm text-brand-500">
          {products.length} {pluralProducts(products.length)}
        </p>
      </div>

      <div className="flex flex-col gap-4 border-y border-brand-100 py-4 lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label="Фильтры каталога" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0">
          <FilterChip href={buildHref({ sort: searchParams.sort })} active={!searchParams.category && !concern}>
            Все товары
          </FilterChip>
          {categories.map((c) => (
            <FilterChip
              key={c.id}
              href={buildHref({ category: c.slug, sort: searchParams.sort })}
              active={searchParams.category === c.slug}
            >
              {c.name}
            </FilterChip>
          ))}
          <span className="mx-1 w-px shrink-0 self-stretch bg-brand-200" aria-hidden="true" />
          {concerns.map((c) => (
            <FilterChip
              key={c.id}
              href={buildHref({ concern: c.slug, sort: searchParams.sort })}
              active={searchParams.concern === c.slug}
            >
              {concernTitle(c)}
            </FilterChip>
          ))}
        </nav>

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

function FilterChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full border px-4 text-[13px] font-semibold transition-colors duration-200 ${
        active
          ? "border-brand-900 bg-brand-900 text-white"
          : "border-brand-200 text-brand-700 hover:border-brand-400 hover:text-brand-900"
      }`}
    >
      {children}
    </a>
  );
}

// 1 товар, 2–4 товара, 5+ товаров (11–14 — «товаров»)
function pluralProducts(n: number): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "товар";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "товара";
  return "товаров";
}
