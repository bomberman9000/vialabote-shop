import { notFound } from "next/navigation";
import Image from "next/image";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/money";
import { AddToCartButton } from "@/components/add-to-cart-button";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: { slug: string } }) {
  const product = await prisma.product.findUnique({
    where: { slug: params.slug },
    include: { category: true },
  });

  if (!product || !product.isActive) notFound();

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-brand-100">
        <Image src={product.imageUrl} alt={product.title} fill className="object-cover" sizes="500px" />
      </div>

      <div className="flex flex-col gap-4">
        <p className="text-sm text-brand-500">{product.category.name}</p>
        <h1 className="text-2xl font-semibold text-brand-800">{product.title}</h1>

        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-semibold text-brand-800">{formatPrice(product.price)}</span>
          {product.oldPrice ? (
            <span className="text-brand-400 line-through">{formatPrice(product.oldPrice)}</span>
          ) : null}
        </div>

        <p className="whitespace-pre-line text-brand-600">{product.description}</p>

        <p className="text-sm text-brand-500">
          {product.stock > 0 ? `В наличии: ${product.stock} шт.` : "Нет в наличии"}
        </p>

        <AddToCartButton
          product={{
            id: product.id,
            slug: product.slug,
            title: product.title,
            price: product.price,
            imageUrl: product.imageUrl,
            stock: product.stock,
          }}
        />
      </div>
    </div>
  );
}
