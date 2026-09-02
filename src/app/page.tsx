import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { FlaskConical, Sprout, ShieldCheck, Factory, Sparkles } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { ProductCard } from "@/components/product-card";
import { Hero } from "@/components/hero";
import { CONCERNS } from "@/lib/concerns";
import { resolveDisplayPrice } from "@/lib/pricing/product-price";

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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
            {products.map((p) => {
              const displayPrice = resolveDisplayPrice(p);
              return (
                <ProductCard
                  key={p.id}
                  product={{
                    id: p.id,
                    slug: p.slug,
                    title: p.title,
                    subtitle: p.subtitle,
                    price: displayPrice.price,
                    oldPrice: displayPrice.compareAtPrice,
                    imageUrl: p.imageUrl,
                    stock: p.stock,
                  }}
                />
              );
            })}
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
              <badge.icon size={20} strokeWidth={1.6} className="shrink-0 text-gold-300" aria-hidden="true" />
              <span className="text-sm">{badge.label.replace("\n", " ")}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
