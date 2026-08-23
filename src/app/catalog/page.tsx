import { prisma } from "@/lib/prisma";
import { ProductCard } from "@/components/product-card";

export const dynamic = "force-dynamic";

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: { category?: string };
}) {
  const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      ...(searchParams.category ? { category: { slug: searchParams.category } } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-brand-800">Каталог</h1>

      <div className="flex flex-wrap gap-2">
        <a
          href="/catalog"
          className={`btn-outline ${!searchParams.category ? "bg-brand-100" : ""}`}
        >
          Все товары
        </a>
        {categories.map((c) => (
          <a
            key={c.id}
            href={`/catalog?category=${c.slug}`}
            className={`btn-outline ${searchParams.category === c.slug ? "bg-brand-100" : ""}`}
          >
            {c.name}
          </a>
        ))}
      </div>

      {products.length === 0 ? (
        <p className="text-brand-500">В этой категории пока нет товаров.</p>
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
    </div>
  );
}
