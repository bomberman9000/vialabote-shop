import type { Metadata } from "next";
import Link from "next/link";
import { FlaskConical, Sprout, ShieldCheck, Factory, Sparkles } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { ProductCard, ProductGrid } from "@/components/product-card";
import { ConcernCard } from "@/components/concern-card";
import { toProductCardData } from "@/lib/product-card-data";
import { Hero } from "@/components/hero";
import { concernTitle } from "@/lib/concerns";

export const dynamic = "force-dynamic";

// rf_concern/rf_skin/rf_scope — shareable-состояние Routine Finder;
// canonical держит все такие варианты на базовой "/", без отдельной индексации.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// Формулировки бренда (vialabote.ru) + описания по утверждённому макету.
// Иконки — Lucide (единственная утверждённая icon-система storefront), без emoji.
const TRUST_BADGES = [
  {
    icon: FlaskConical,
    label: "Формулы\nс активными компонентами",
    description: "Рабочие концентрации и продуманные сочетания",
  },
  {
    icon: Sprout,
    label: "Продуманные\nсоставы",
    description: "Баланс природы и науки в каждой формуле",
  },
  {
    icon: ShieldCheck,
    label: "Контроль\nкачества",
    description: "Многоступенчатая проверка на всех этапах производства",
  },
  {
    icon: Factory,
    label: "Собственное\nпроизводство",
    description: "Современные лаборатории и высокие стандарты",
  },
  {
    icon: Sparkles,
    label: "Уход по\nпотребностям кожи",
    description: "Подберите программу ухода с помощью Routine Finder",
  },
];

export default async function HomePage() {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
    include: { discount: true },
  });

  // Плитки потребностей строятся по БД: список — из Concern, картинка — из
  // реального опубликованного товара этой потребности. Потребность без единого
  // видимого товара плитку не получает, поэтому архивация SKU не оставляет
  // ссылку на пустой фильтр, а новый размеченный товар подхватывается сам.
  const concerns = await prisma.concern.findMany({ orderBy: { name: "asc" } });
  const concernTiles = (
    await Promise.all(
      concerns.map(async (concern) => {
        const product = await prisma.product.findFirst({
          where: { isActive: true, concerns: { some: { concern: { slug: concern.slug } } } },
          orderBy: { createdAt: "desc" },
          select: { imageUrl: true },
        });
        return product
          ? { slug: concern.slug, title: concernTitle(concern), image: product.imageUrl }
          : null;
      }),
    )
  ).filter((tile): tile is NonNullable<typeof tile> => tile !== null);

  return (
    <div className="flex flex-col gap-14 md:gap-20">
      <Hero />

      {/* WHY VIALABOTE — реальные формулировки бренда */}
      <section className="grid grid-cols-2 gap-y-8 sm:grid-cols-3 md:grid-cols-5 md:gap-y-0">
        {TRUST_BADGES.map((badge, i) => (
          <div
            key={badge.label}
            className={`flex flex-col gap-3 px-4 md:px-6 ${
              i > 0 ? "md:border-l md:border-brand-100" : ""
            }`}
          >
            <badge.icon size={32} strokeWidth={1.4} className="text-gold-500" aria-hidden="true" />
            <span className="whitespace-pre-line text-sm font-bold leading-snug text-brand-900">
              {badge.label}
            </span>
            <span className="text-[13px] leading-relaxed text-brand-500">{badge.description}</span>
          </div>
        ))}
      </section>

      {/* BESTSELLERS — сразу после hero и trust-блока */}
      <section>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-display text-2xl text-brand-800">Бестселлеры</h2>
          <Link href="/catalog" className="text-sm text-brand-600 hover:underline">
            Весь каталог →
          </Link>
        </div>
        {products.length === 0 ? (
          <p className="text-brand-500">
            Товары пока не добавлены. Зайдите в админ-панель (/admin/products), чтобы добавить первые
            товары, либо выполните `npm run db:seed`.
          </p>
        ) : (
          <ProductGrid columns={3}>
            {products.map((p) => (
              <ProductCard key={p.id} product={toProductCardData(p)} />
            ))}
          </ProductGrid>
        )}
      </section>

      {/* SHOP BY CONCERN — состав и картинки из БД, без фиктивной таксономии */}
      {concernTiles.length > 0 && (
        <section id="concerns">
          <h2 className="mb-6 font-display text-2xl text-brand-800">
            Подберите уход по потребности
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-5 max-md:[&>*:last-child:nth-child(odd)]:col-span-2 max-md:[&>*:last-child:nth-child(odd)]:aspect-[2/1]">
            {concernTiles.map((concern) => (
              <ConcernCard key={concern.slug} concern={concern} />
            ))}
          </div>
        </section>
      )}

      {/* BRAND STORY */}
      <section id="about" className="card-dark grid gap-8 p-8 md:grid-cols-2 md:p-14">
        <div className="flex flex-col justify-center gap-3">
          <p className="text-xs uppercase tracking-[0.25em] text-gold-300">О бренде</p>
          <h2 className="font-display text-3xl">Наука. Природа. Гармония.</h2>
          <p className="max-w-md text-brand-200">
            Via Labote — лаборатория персональной косметики, где каждая формула создаётся как
            точный ответ коже. Здесь продукция бренда доступна напрямую — только оригинальные
            средства, — а уход можно подобрать под задачи именно вашей кожи.
          </p>
        </div>
        <div className="flex flex-col justify-center gap-4 border-t border-brand-700 pt-6 md:border-l md:border-t-0 md:pl-10 md:pt-0">
          {TRUST_BADGES.map((badge) => (
            <div key={badge.label} className="flex items-center gap-3 text-brand-100">
              <badge.icon size={20} strokeWidth={1.6} className="shrink-0 text-gold-300" aria-hidden="true" />
              <span className="text-sm">{badge.label.replace("\n", " ")}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
