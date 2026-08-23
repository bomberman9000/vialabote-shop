import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ProductCard } from "@/components/product-card";

export const dynamic = "force-dynamic";

const TRUST_BADGES = [
  { icon: "🧪", label: "Эффективные формулы" },
  { icon: "🌿", label: "Натуральные компоненты" },
  { icon: "🛡️", label: "Безопасно для кожи" },
  { icon: "✅", label: "Дерматологически протестировано" },
];

const CATEGORY_TILES = [
  {
    title: "Персональный уход",
    subtitle: "Твоя индивидуальная история",
    href: "/catalog?category=uhod-za-litsom",
  },
  {
    title: "Магазин косметики",
    subtitle: "Твой готовый уход",
    href: "/catalog",
  },
];

export default async function HomePage() {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  return (
    <div className="flex flex-col gap-16">
      <section className="card flex flex-col items-start gap-4 overflow-hidden p-10 md:p-16">
        <p className="text-sm uppercase tracking-[0.2em] text-brand-400">Наука. Природа. Гармония.</p>
        <h1 className="max-w-2xl text-3xl font-semibold text-brand-800 md:text-4xl">
          Vialabote — лаборатория персональной косметики, где каждая формула — точный ответ коже
        </h1>
        <p className="max-w-xl text-brand-600">
          Раньше — только на Wildberries и Ozon. Теперь у нас свой магазин: прямая доставка,
          честные цены без комиссии маркетплейсов и бонусы для постоянных покупателей.
        </p>
        <div className="flex gap-3">
          <Link href="/catalog" className="btn-primary">
            Смотреть каталог
          </Link>
          <Link href="#about" className="btn-outline">
            О бренде
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {TRUST_BADGES.map((badge) => (
          <div key={badge.label} className="card flex flex-col items-center gap-2 p-4 text-center">
            <span className="text-2xl">{badge.icon}</span>
            <span className="text-xs font-medium uppercase tracking-wide text-brand-600">
              {badge.label}
            </span>
          </div>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {CATEGORY_TILES.map((tile) => (
          <Link
            key={tile.title}
            href={tile.href}
            className="card group flex min-h-[220px] flex-col justify-end gap-1 bg-gradient-to-br from-brand-100 to-brand-200 p-8 transition-transform hover:-translate-y-0.5"
          >
            <span className="text-xs uppercase tracking-wide text-brand-500">{tile.subtitle}</span>
            <span className="text-2xl font-semibold text-brand-800">{tile.title}</span>
            <span className="mt-2 text-sm text-brand-600 group-hover:underline">Подробнее →</span>
          </Link>
        ))}
      </section>

      <section>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-brand-800">Новинки и бестселлеры</h2>
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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {products.map((p) => (
              <ProductCard
                key={p.id}
                product={{
                  id: p.id,
                  slug: p.slug,
                  title: p.title,
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

      <section id="about" className="card p-8">
        <h2 className="mb-2 text-xl font-semibold text-brand-800">О бренде</h2>
        <p className="text-brand-600">
          Vialabote — лаборатория персональной косметики: каждая формула создаётся как точный ответ
          коже. Этот сайт — наш собственный интернет-магазин, дополняющий продажи на маркетплейсах:
          здесь действуют отдельные акции, есть личный кабинет с историей заказов и прямая связь
          с нами.
        </p>
      </section>
    </div>
  );
}
