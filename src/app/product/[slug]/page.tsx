import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Image from "next/image";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/money";
import { AddToCartButton } from "@/components/add-to-cart-button";
import { ProductCard } from "@/components/product-card";
import { resolveDisplayPrice } from "@/lib/pricing/product-price";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const product = await prisma.product.findUnique({ where: { slug: params.slug } });
  if (!product) return {};
  return {
    title: `${product.title} — Via Labote`,
    description: product.subtitle || product.description,
  };
}

function parseLines(value: string | null): string[] {
  if (!value) return [];
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export default async function ProductPage({ params }: { params: { slug: string } }) {
  const product = await prisma.product.findUnique({
    where: { slug: params.slug },
    include: { category: true, discount: true },
  });

  if (!product || !product.isActive) notFound();

  const related = await prisma.product.findMany({
    where: {
      isActive: true,
      categoryId: product.categoryId,
      id: { not: product.id },
    },
    take: 4,
    include: { discount: true },
  });

  const actives = parseLines(product.activeIngredients);
  const howToUseSteps = parseLines(product.howToUse);
  const displayPrice = resolveDisplayPrice(product);

  return (
    <div className="flex flex-col gap-14">
      <div className="grid gap-10 md:grid-cols-2">
        {/* GALLERY — сейчас одно фото на товар, доп. изображений в assets нет */}
        <div className="relative aspect-square overflow-hidden rounded-2xl bg-brand-50">
          <Image
            src={product.imageUrl}
            alt={product.title}
            fill
            className="object-contain p-10"
            sizes="500px"
            priority
          />
          {product.badge ? (
            <span className="absolute left-4 top-4 rounded-full bg-gold-400 px-3 py-1 text-xs font-medium uppercase tracking-wide text-brand-900">
              {product.badge}
            </span>
          ) : null}
        </div>

        {/* PURCHASE INFO */}
        <div className="flex flex-col gap-4">
          <Link
            href={`/catalog?category=${product.category.slug}`}
            className="w-fit text-sm text-brand-500 hover:underline"
          >
            {product.category.name}
          </Link>
          <h1 className="font-display text-3xl text-brand-800">{product.title}</h1>
          {product.subtitle ? <p className="text-brand-600">{product.subtitle}</p> : null}

          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-semibold text-brand-800">
              {formatPrice(displayPrice.price)}
            </span>
            {displayPrice.compareAtPrice ? (
              <span className="text-brand-400 line-through">{formatPrice(displayPrice.compareAtPrice)}</span>
            ) : null}
            {product.volume ? <span className="text-sm text-brand-400">{product.volume}</span> : null}
          </div>

          {actives.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {actives.slice(0, 3).map((line) => (
                <span
                  key={line}
                  className="rounded-full bg-brand-100 px-3 py-1 text-xs text-brand-700"
                >
                  {line.split(" — ")[0]}
                </span>
              ))}
            </div>
          ) : null}

          <p className="text-sm font-medium">
            {product.stock > 0 ? (
              <span className="text-green-700">В наличии</span>
            ) : (
              <span className="text-red-600">Нет в наличии</span>
            )}
          </p>

          <AddToCartButton
            product={{
              id: product.id,
              slug: product.slug,
              title: product.title,
              price: displayPrice.price,
              imageUrl: product.imageUrl,
              stock: product.stock,
            }}
          />

          <div className="mt-2 flex flex-col gap-1 border-t border-brand-100 pt-4 text-xs text-brand-500">
            <span>🚚 Доставка по России курьером и в пункты выдачи</span>
            <span>💳 Безопасная онлайн-оплата картой через ЮKassa</span>
          </div>
        </div>
      </div>

      {/* PDP CONTENT */}
      <div className="grid gap-8 md:grid-cols-2">
        <section className="card p-6">
          <h2 className="mb-2 font-display text-xl text-brand-800">Что делает</h2>
          <p className="whitespace-pre-line text-brand-600">{product.description}</p>
        </section>

        {actives.length > 0 ? (
          <section className="card p-6">
            <h2 className="mb-2 font-display text-xl text-brand-800">Активные компоненты</h2>
            <ul className="flex flex-col gap-2 text-brand-600">
              {actives.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {howToUseSteps.length > 0 ? (
          <section className="card p-6">
            <h2 className="mb-2 font-display text-xl text-brand-800">Как использовать</h2>
            <ul className="flex flex-col gap-2 text-brand-600">
              {howToUseSteps.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="card p-6">
          <h2 className="mb-2 font-display text-xl text-brand-800">Доставка и оплата</h2>
          <p className="text-brand-600">
            Доставка по России курьером и в пункты выдачи. Онлайн-оплата картой через ЮKassa —
            подтверждение оплаты приходит сразу после списания средств.
          </p>
        </section>
      </div>

      {/* CROSS-SELL — только реальная связь "тот же уход/категория", без выдуманных routine-шагов */}
      {related.length > 0 ? (
        <section>
          <h2 className="mb-6 font-display text-2xl text-brand-800">Дополните уход</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {related.map((p) => {
              const relatedPrice = resolveDisplayPrice(p);
              return (
                <ProductCard
                  key={p.id}
                  product={{
                    id: p.id,
                    slug: p.slug,
                    title: p.title,
                    subtitle: p.subtitle,
                    badge: p.badge,
                    price: relatedPrice.price,
                    oldPrice: relatedPrice.compareAtPrice,
                    imageUrl: p.imageUrl,
                    stock: p.stock,
                  }}
                />
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
