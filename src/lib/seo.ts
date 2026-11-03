// Разметка schema.org (JSON-LD) для поисковиков: товар с ценой и наличием, хлебные крошки, магазин.
// Яндекс и Google показывают по ней цену и наличие прямо в выдаче.
import { SITE_URL } from "@/lib/share-image";

export const BRAND = "VIA LABOTE";

const abs = (path: string) => (/^https?:\/\//.test(path) ? path : `${SITE_URL}${path.startsWith("/") ? "" : "/"}${path}`);

/** Копейки -> «1234.50» (schema.org ждёт число в рублях строкой с точкой). */
const rub = (kopecks: number) => (kopecks / 100).toFixed(2);

export function productJsonLd(p: {
  slug: string;
  title: string;
  description: string | null;
  subtitle?: string | null;
  imageUrl: string;
  images?: string[];
  stock: number;
  price: number;
  categoryName?: string | null;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.title,
    description: p.subtitle || p.description || undefined,
    image: [p.imageUrl, ...(p.images ?? [])].map(abs),
    sku: p.slug,
    brand: { "@type": "Brand", name: BRAND },
    ...(p.categoryName ? { category: p.categoryName } : {}),
    offers: {
      "@type": "Offer",
      url: abs(`/product/${p.slug}`),
      priceCurrency: "RUB",
      price: rub(p.price),
      availability: p.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@type": "Organization", name: BRAND },
    },
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: abs(it.path) })),
  };
}

export function storeJsonLd() {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: BRAND,
      url: SITE_URL,
      logo: abs("/og/vialabote-share.jpg"),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: BRAND,
      url: SITE_URL,
      inLanguage: "ru-RU",
    },
  ];
}

/**
 * JSON для <script type="application/ld+json">. «<» экранируем: текст товара из админки не должен закрыть
 * тег script (`</script>`) и выполнить что-то на странице.
 */
export function jsonLdHtml(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
