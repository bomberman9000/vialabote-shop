import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/money";
import { resolveDisplayPrice } from "@/lib/pricing/product-price";
import { ProductContentForm } from "./product-content-form";
import { ProductPriceForm } from "./product-price-form";
import { ProductDiscountForm } from "./product-discount-form";
import { ProductMediaManager } from "./product-media-manager";
import { ProductLifecycleActions } from "./product-lifecycle-actions";

export const dynamic = "force-dynamic";

export default async function AdminProductDetailPage({ params }: { params: { id: string } }) {
  const product = await prisma.product.findUnique({
    where: { id: params.id },
    include: { category: true, discount: true, media: { orderBy: { order: "asc" } } },
  });

  if (!product) notFound();

  const displayPrice = resolveDisplayPrice(product);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/products" className="text-sm text-brand-500 hover:underline">
            ← Все товары
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-brand-800">{product.title}</h1>
          <p className="text-sm text-brand-500">
            slug: {product.slug} · статус: {product.status} · версия: {product.version}
          </p>
        </div>
        <ProductLifecycleActions productId={product.id} status={product.status} version={product.version} />
      </div>

      <section className="card grid gap-4 p-6">
        <h2 className="font-semibold text-brand-800">Цена и скидка</h2>
        <p className="text-sm text-brand-500">
          Базовая цена: {formatPrice(product.price)}
          {displayPrice.discountApplied ? <> · сейчас к оплате: {formatPrice(displayPrice.price)}</> : null}
        </p>
        <div className="grid gap-6 md:grid-cols-2">
          <ProductPriceForm productId={product.id} version={product.version} currentPriceKopecks={product.price} />
          <ProductDiscountForm
            productId={product.id}
            version={product.version}
            discount={
              product.discount
                ? {
                    type: product.discount.type,
                    value: product.discount.value,
                    startsAt: product.discount.startsAt?.toISOString() ?? null,
                    endsAt: product.discount.endsAt?.toISOString() ?? null,
                  }
                : null
            }
          />
        </div>
      </section>

      <section className="card grid gap-4 p-6">
        <h2 className="font-semibold text-brand-800">Контент</h2>
        <ProductContentForm
          productId={product.id}
          version={product.version}
          initial={{
            title: product.title,
            subtitle: product.subtitle ?? "",
            description: product.description,
            activeIngredients: product.activeIngredients ?? "",
            howToUse: product.howToUse ?? "",
            volume: product.volume ?? "",
            badge: product.badge ?? "",
          }}
        />
      </section>

      <section className="card grid gap-4 p-6">
        <h2 className="font-semibold text-brand-800">Медиа</h2>
        <ProductMediaManager
          productId={product.id}
          media={product.media.map((m) => ({
            id: m.id,
            url: m.url,
            purpose: m.purpose,
            isPrimary: m.isPrimary,
            width: m.width,
            height: m.height,
          }))}
        />
      </section>
    </div>
  );
}
