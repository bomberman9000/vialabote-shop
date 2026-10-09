import { prisma } from "@/lib/prisma";
import { resolveDisplayPrice } from "@/lib/pricing/product-price";
import { normalizeSearchText, type SearchProduct } from "@/lib/search";

// Индекс поиска для шапки: только опубликованные товары, цена — через тот же
// resolveDisplayPrice, что и в карточках. Для текущего каталога (единицы-
// десятки SKU) индекс целиком уходит клиенту — отдельный backend не нужен.
export async function getSearchProducts(): Promise<SearchProduct[]> {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    include: {
      category: true,
      concerns: { include: { concern: true } },
      discount: true,
    },
    orderBy: [{ displayOrder: "asc" }, { title: "asc" }],
  });

  return products.map((p) => {
    const price = resolveDisplayPrice(p);
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      subtitle: p.subtitle,
      imageUrl: p.imageUrl,
      price: price.price,
      oldPrice: price.compareAtPrice,
      haystack: normalizeSearchText(
        [
          p.title,
          p.subtitle,
          p.description,
          p.activeIngredients,
          p.volume,
          p.category.name,
          ...p.concerns.map((c) => c.concern.name),
        ]
          .filter(Boolean)
          .join(" "),
      ),
    };
  });
}
