// Разметка schema.org (JSON-LD) для поисковиков: товар с ценой и наличием, хлебные крошки, магазин.
// Яндекс и Google показывают по ней цену и наличие прямо в выдаче.
import type { Metadata } from "next";
import { SHARE_IMAGE, SITE_URL } from "@/lib/share-image";

export const BRAND = "VIA LABOTE";

const abs = (path: string) => (/^https?:\/\//.test(path) ? path : `${SITE_URL}${path.startsWith("/") ? "" : "/"}${path}`);

/**
 * Мета-описание страницы: canonical, OG и Twitter на одном адресе.
 *
 * `openGraph` страницы целиком заменяет общий из layout — siteName и locale повторяем.
 * Без этого на юридических страницах og:url оставался бы адресом главной,
 * а поисковик получил бы описание главной вместо описания страницы.
 */
export function pageMetadata(path: string, title: string, description: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: BRAND,
      locale: "ru_RU",
      url: path,
      title,
      description,
      images: [SHARE_IMAGE],
    },
    twitter: { card: "summary_large_image", title, description, images: [SHARE_IMAGE.url] },
  };
}

/**
 * Описание товара для meta/og-описания.
 *
 * Подзаголовок из карточки бывает короче 70 символов («Без аромата · СТЕБЛЕВ»): в выдаче
 * и в превью такое описание показывают целиком, и обрезанный фрагмент ничего не сообщает.
 * Дополняем его названием товара и тем, что магазин известен — без выдуманных обещаний.
 */
export function productMetaDescription(base: string | null | undefined, title: string): string {
  const text = (base || "").trim();
  if (text.length >= 70) return text;
  const tail = `${title} — уход и косметика VIA LABOTE: описание, применение и доставка по России.`;
  return text ? `${text} ${tail}` : tail;
}

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
