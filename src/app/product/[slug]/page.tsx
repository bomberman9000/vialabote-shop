import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CreditCard, Truck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/money";
import { AddToCartButton } from "@/components/add-to-cart-button";
import { ProductCard, ProductGrid } from "@/components/product-card";
import { toProductCardData } from "@/lib/product-card-data";
import { resolveDisplayPrice } from "@/lib/pricing/product-price";
import { concernTitle } from "@/lib/concerns";
import { ProductGallery } from "@/components/product-gallery";
import { Reveal } from "@/components/reveal";

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
    include: {
      category: true,
      discount: true,
      skinTypes: { include: { skinType: true } },
      concerns: { include: { concern: true } },
      media: {
        where: { purpose: "PRODUCT_GALLERY", validationState: "valid" },
        orderBy: { order: "asc" },
      },
    },
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
  // «Для кого» — только из реальных связей товара (типы кожи/потребности),
  // ничего не додумывается; блок не показывается, если связей нет.
  const forWhom = [
    ...product.concerns.map((c) => concernTitle(c.concern)),
    ...product.skinTypes.map((s) => `${s.skinType.name} кожа`),
  ];
  const gallery = [
    { url: product.imageUrl, alt: product.title },
    ...product.media.map((m, i) => ({ url: m.url, alt: `${product.title}, фото ${i + 2}` })),
  ];
  const splitActive = (line: string) => {
    const [name, ...rest] = line.split(" — ");
    return { name, text: rest.join(" — ") };
  };

  return (
    <div className="flex flex-col gap-16 md:gap-24">
      <div className="grid gap-8 md:grid-cols-[1.05fr_0.95fr] md:gap-12 lg:gap-16">
        {/* GALLERY — sticky на desktop, пока читается описание */}
        <div className="md:sticky md:top-28 md:self-start">
          <ProductGallery images={gallery} badge={product.badge} />
        </div>

        {/* PURCHASE INFO */}
        <div className="flex flex-col gap-5 md:py-4">
          <Link
            href={`/catalog?category=${product.category.slug}`}
            className="w-fit text-[11px] font-bold uppercase tracking-[0.22em] text-gold-500 hover:text-gold-600"
          >
            {product.category.name}
          </Link>
          <h1 className="text-[2rem] leading-[1.08] text-brand-900 sm:text-[2.5rem]">{product.title}</h1>
          {product.subtitle ? (
            <p className="text-lg leading-snug text-brand-600">{product.subtitle}</p>
          ) : null}

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[1.75rem] font-bold tabular-nums text-brand-900">
              {formatPrice(displayPrice.price)}
            </span>
            {displayPrice.compareAtPrice ? (
              <span className="text-brand-400 line-through">
                <span className="sr-only">Старая цена: </span>
                {formatPrice(displayPrice.compareAtPrice)}
              </span>
            ) : null}
            {product.volume ? <span className="text-sm text-brand-500">· {product.volume}</span> : null}
          </div>

          <p className="text-sm font-semibold">
            {product.stock > 0 ? (
              <span className="text-emerald-700">В наличии</span>
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

          {actives.length > 0 ? (
            <div className="flex flex-col gap-2.5 border-t border-brand-100 pt-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-500">Ключевые компоненты</p>
              <div className="flex flex-wrap gap-2">
                {actives.map((line) => (
                  <span key={line} className="rounded-full border border-brand-200 bg-white/60 px-3 py-1.5 text-xs font-semibold text-brand-800">
                    {splitActive(line).name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {forWhom.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-500">Для кого</p>
              <div className="flex flex-wrap gap-2">
                {forWhom.map((label) => (
                  <span key={label} className="rounded-full bg-[#F1EADF] px-3 py-1.5 text-xs font-semibold text-brand-800">
                    {label}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 border-t border-brand-100 pt-5 text-[13px] text-brand-600">
            <span className="inline-flex items-center gap-2.5"><Truck size={16} strokeWidth={1.6} aria-hidden="true" className="shrink-0 text-gold-500" />Доставка по России курьером и в пункты выдачи</span>
            <span className="inline-flex items-center gap-2.5"><CreditCard size={16} strokeWidth={1.6} aria-hidden="true" className="shrink-0 text-gold-500" />Безопасная онлайн-оплата картой через ЮKassa</span>
          </div>
        </div>
      </div>

      {/* PDP CONTENT — редакционные строки вместо карточек */}
      <Reveal>
        <div className="border-t border-brand-200">
          <PdpRow title="Что делает">
            <p className="max-w-[62ch] whitespace-pre-line text-[15px] leading-relaxed text-brand-700">{product.description}</p>
          </PdpRow>
          {actives.length > 0 ? (
            <PdpRow title="Активные компоненты">
              <dl className="grid gap-4 sm:grid-cols-2">
                {actives.map((line) => {
                  const a = splitActive(line);
                  return (
                    <div key={line} className="flex flex-col gap-1">
                      <dt className="text-sm font-bold text-brand-900">{a.name}</dt>
                      {a.text ? <dd className="text-sm leading-relaxed text-brand-600">{a.text}</dd> : null}
                    </div>
                  );
                })}
              </dl>
            </PdpRow>
          ) : null}
          {howToUseSteps.length > 0 ? (
            <PdpRow title="Как использовать">
              <ol className="flex flex-col gap-3">
                {howToUseSteps.map((line, i) => (
                  <li key={line} className="flex gap-4 text-[15px] leading-relaxed text-brand-700">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold-400 text-xs font-bold text-gold-600">
                      {i + 1}
                    </span>
                    <span className="pt-0.5">{line}</span>
                  </li>
                ))}
              </ol>
            </PdpRow>
          ) : null}
          <PdpRow title="Доставка и оплата">
            <p className="max-w-[62ch] text-[15px] leading-relaxed text-brand-700">
              Доставка по России курьером и в пункты выдачи. Онлайн-оплата картой через ЮKassa —
              подтверждение оплаты приходит сразу после списания средств.
            </p>
          </PdpRow>
        </div>
      </Reveal>

      {/* CROSS-SELL — только реальная связь "тот же уход/категория", без выдуманных routine-шагов */}
      {related.length > 0 ? (
        <Reveal>
        <section aria-labelledby="related-title">
          <div className="mb-8 flex flex-col gap-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-gold-500">Рекомендации</p>
            <h2 id="related-title" className="text-[1.75rem] leading-tight text-brand-900 sm:text-[2.1rem]">Дополните уход</h2>
          </div>
          <ProductGrid>
            {related.map((p) => (
              <ProductCard key={p.id} product={toProductCardData(p)} />
            ))}
          </ProductGrid>
        </section>
        </Reveal>
      ) : null}
    </div>
  );
}

function PdpRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-brand-200 py-8 md:grid-cols-[240px_1fr] md:gap-10 md:py-10">
      <h2 className="text-lg leading-snug text-brand-900">{title}</h2>
      <div>{children}</div>
    </section>
  );
}
