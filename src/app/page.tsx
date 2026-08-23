import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { prisma } from "@/lib/prisma";
import { ProductCard } from "@/components/product-card";
import { CONCERNS } from "@/lib/concerns";
import { RoutineFinderTrigger } from "@/components/routine-finder/routine-finder-trigger";

export const dynamic = "force-dynamic";

// rf_concern/rf_skin/rf_scope — shareable-состояние Routine Finder;
// canonical держит все такие варианты на базовой "/", без отдельной индексации.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// Бейджи скопированы дословно с действующего сайта vialabote.ru — это
// собственные формулировки бренда, а не придуманные здесь маркетинговые клеймы.
const TRUST_BADGES = [
  { icon: "🧪", label: "Эффективные формулы" },
  { icon: "🌿", label: "Натуральные компоненты" },
  { icon: "🛡️", label: "Безопасно для кожи" },
  { icon: "✅", label: "Дерматологически протестировано" },
  { icon: "🏭", label: "Собственное производство" },
];

const HERO_BOTTLES = [
  { image: "/images/products/antiaa2.webp", alt: "Multi3 Anti-Acne Serum" },
  { image: "/images/products/gidrofil.webp", alt: "Гидрофильное гель-масло" },
  { image: "/images/products/retinal23.webp", alt: "INCI Retinal Serum" },
  { image: "/images/products/8in1.webp", alt: "Сыворотка 8 in 1 White Tea" },
];

export default async function HomePage() {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="flex flex-col gap-14 md:gap-20">
      {/* HERO */}
      <section className="card-dark grid gap-8 overflow-hidden p-8 md:grid-cols-2 md:p-14">
        <div className="flex flex-col items-start justify-center gap-4">
          <p className="text-xs uppercase tracking-[0.25em] text-gold-300">
            Наука. Природа. Гармония.
          </p>
          <h1 className="max-w-md font-display text-4xl leading-tight md:text-5xl">
            Лаборатория персональной косметики для здоровой кожи
          </h1>
          <p className="max-w-sm text-brand-200">
            Эффективные формулы с доказанными активами и натуральными компонентами. Создано с
            вниманием к вашей коже и её потребностям.
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <Link href="/catalog" className="btn-gold">
              Смотреть каталог
            </Link>
            <RoutineFinderTrigger className="btn-outline border-brand-500 text-brand-50 hover:bg-brand-800">
              Подобрать уход
            </RoutineFinderTrigger>
          </div>
        </div>

        <div className="flex items-end justify-center gap-3 self-end sm:gap-5">
          {/* Единая "витрина": реальные фото товаров, общая подложка секции,
              без отдельных рамок-коробок вокруг каждого флакона */}
          {HERO_BOTTLES.map((bottle, i) => (
            <div
              key={bottle.image}
              className={`relative aspect-[3/4] w-1/4 max-w-[150px] ${i % 2 === 0 ? "" : "-translate-y-4 sm:-translate-y-6"}`}
            >
              <Image
                src={bottle.image}
                alt={bottle.alt}
                fill
                className="object-contain drop-shadow-[0_16px_20px_rgba(0,0,0,0.4)]"
                sizes="(min-width: 768px) 180px, 120px"
                priority={i === 0}
              />
            </div>
          ))}
        </div>
      </section>

      {/* WHY VIALABOTE — реальные формулировки бренда */}
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
        {TRUST_BADGES.map((badge) => (
          <div key={badge.label} className="card flex flex-col items-center gap-2 p-4 text-center">
            <span className="text-2xl">{badge.icon}</span>
            <span className="text-xs font-medium uppercase tracking-wide text-brand-600">
              {badge.label}
            </span>
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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
            {products.map((p) => (
              <ProductCard
                key={p.id}
                product={{
                  id: p.id,
                  slug: p.slug,
                  title: p.title,
                  subtitle: p.subtitle,
                  price: p.price,
                  oldPrice: p.oldPrice,
                  imageUrl: p.imageUrl,
                  stock: p.stock,
                }}
              />
            ))}
          </div>
        )}
      </section>

      {/* SHOP BY CONCERN — только реальные товары, без фиктивной таксономии */}
      <section id="concerns">
        <h2 className="mb-6 font-display text-2xl text-brand-800">Подберите уход по потребности</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {CONCERNS.map((concern) => (
            <Link
              key={concern.slug}
              href={`/catalog?concern=${concern.slug}`}
              className="card group flex flex-col overflow-hidden transition-transform hover:-translate-y-0.5"
            >
              <div className="relative aspect-square bg-brand-50">
                <Image
                  src={concern.image}
                  alt={concern.title}
                  fill
                  className="object-contain p-6"
                  sizes="200px"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1 p-4">
                <span className="text-sm font-medium text-brand-800">{concern.title}</span>
                <span className="mt-auto text-xs text-brand-500 group-hover:underline">
                  Смотреть →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* BRAND STORY */}
      <section id="about" className="card-dark grid gap-8 p-8 md:grid-cols-2 md:p-14">
        <div className="flex flex-col justify-center gap-3">
          <p className="text-xs uppercase tracking-[0.25em] text-gold-300">О бренде</p>
          <h2 className="font-display text-3xl">Наука. Природа. Гармония.</h2>
          <p className="max-w-md text-brand-200">
            Via Labote — лаборатория персональной косметики, где каждая формула создаётся как
            точный ответ коже. Этот сайт — наш собственный интернет-магазин: здесь действуют
            отдельные условия, есть личный кабинет с историей заказов и прямая связь с нами —
            без комиссий и правил маркетплейсов.
          </p>
        </div>
        <div className="flex flex-col justify-center gap-4 border-t border-brand-700 pt-6 md:border-l md:border-t-0 md:pl-10 md:pt-0">
          {TRUST_BADGES.map((badge) => (
            <div key={badge.label} className="flex items-center gap-3 text-brand-100">
              <span className="text-xl">{badge.icon}</span>
              <span className="text-sm">{badge.label}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
