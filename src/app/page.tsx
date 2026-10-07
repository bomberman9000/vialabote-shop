import type { Metadata } from "next";
import Link from "next/link";
import { FlaskConical, Sprout, ShieldCheck, Factory, Sparkles } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { ProductCard, ProductGrid } from "@/components/product-card";
import Image from "next/image";
import { ConcernCard, ConcernGrid } from "@/components/concern-card";
import { Reveal } from "@/components/reveal";
import { toProductCardData } from "@/lib/product-card-data";
import { Hero } from "@/components/hero";
import { concernTitle, CONCERN_VISUALS } from "@/lib/concerns";

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

  // Плитки потребностей строятся по БД: список — из Concern. Картинка —
  // абстрактная текстура потребности (CONCERN_VISUALS), а для потребности без
  // неё — фото реального опубликованного товара. Потребность без единого
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
        if (!product) return null;
        const visual = CONCERN_VISUALS[concern.slug];
        return {
          slug: concern.slug,
          title: concernTitle(concern),
          image: visual?.image ?? product.imageUrl,
          tone: visual?.tone ?? ("dark" as const),
        };
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
      <Reveal>
      <section aria-labelledby="bestsellers-title">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-gold-500">Коллекция</p>
            <h2 id="bestsellers-title" className="text-[1.75rem] leading-tight text-brand-900 sm:text-[2.1rem]">
              Бестселлеры
            </h2>
          </div>
          <Link
            href="/catalog"
            className="group inline-flex min-h-11 items-center gap-1.5 text-xs font-bold uppercase tracking-[0.1em] text-brand-700 transition-colors hover:text-gold-500"
          >
            Весь каталог
            <span aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-1">→</span>
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
      </Reveal>

      {/* SHOP BY CONCERN — состав и картинки из БД, без фиктивной таксономии */}
      {concernTiles.length > 0 && (
        <Reveal>
        <section id="concerns" aria-labelledby="concerns-title">
          <div className="mb-8 flex flex-col gap-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-gold-500">Задача кожи</p>
            <h2 id="concerns-title" className="text-[1.75rem] leading-tight text-brand-900 sm:text-[2.1rem]">
              Подберите уход по потребности
            </h2>
          </div>
          <ConcernGrid>
            {concernTiles.map((concern) => (
              <ConcernCard key={concern.slug} concern={concern} />
            ))}
          </ConcernGrid>
        </section>
        </Reveal>
      )}

      {/* BRAND STORY */}
      <Reveal>
      <section
        id="about"
        aria-labelledby="about-title"
        className="card-dark grid scroll-mt-28 overflow-hidden md:grid-cols-[1.15fr_0.85fr]"
      >
        <div className="flex flex-col justify-center gap-5 p-8 sm:p-10 md:p-14">
          <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-gold-300">О бренде</p>
          <h2 id="about-title" className="text-[2rem] leading-[1.1] sm:text-[2.5rem]">
            Наука. Природа. Гармония.
          </h2>
          <p className="max-w-[46ch] text-[15px] leading-relaxed text-brand-200 sm:text-base">
            Via Labote — лаборатория персональной косметики, где каждая формула создаётся как
            точный ответ коже. Здесь продукция бренда доступна напрямую — только оригинальные
            средства, — а уход можно подобрать под задачи именно вашей кожи.
          </p>
          <ul className="mt-2 grid gap-3 border-t border-brand-700 pt-6 sm:grid-cols-2">
            {TRUST_BADGES.map((badge) => (
              <li key={badge.label} className="flex items-center gap-3 text-brand-100">
                <badge.icon size={18} strokeWidth={1.6} className="shrink-0 text-gold-300" aria-hidden="true" />
                <span className="text-sm">{badge.label.replace("\n", " ")}</span>
              </li>
            ))}
          </ul>
        </div>
        {/* Редакционный снимок реального продукта бренда (assets/product-media/editorial) */}
        <div className="relative min-h-[280px] md:min-h-full">
          <Image
            src="/images/editorial/brand-story.webp"
            alt="Гидрофильное гель-масло VIA LABOTE"
            fill
            className="object-cover"
            sizes="(min-width: 768px) 40vw, 100vw"
          />
        </div>
      </section>
      </Reveal>
    </div>
  );
}
