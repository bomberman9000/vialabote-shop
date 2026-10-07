import { resolveDisplayPrice, type DisplayPriceInput } from "@/lib/pricing/product-price";

export interface ProductCardData {
  id: string;
  slug: string;
  title: string;
  subtitle?: string | null;
  badge?: string | null;
  price: number;
  oldPrice: number | null;
  imageUrl: string;
  stock: number;
}

type CardSource = DisplayPriceInput & {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  badge: string | null;
  imageUrl: string;
  stock: number;
};

// Единственное место, где товар из БД превращается в данные карточки: цена —
// через resolveDisplayPrice (скидка/oldPrice), badge — только если задан у
// товара. Раньше этот маппинг был скопирован на главной, в каталоге и на PDP
// и успел разойтись (на главной терялся badge).
export function toProductCardData(product: CardSource, now: Date = new Date()): ProductCardData {
  const displayPrice = resolveDisplayPrice(product, now);
  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    subtitle: product.subtitle,
    badge: product.badge,
    price: displayPrice.price,
    oldPrice: displayPrice.compareAtPrice,
    imageUrl: product.imageUrl,
    stock: product.stock,
  };
}
