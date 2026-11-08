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
 * Дополняем его хвостом про магазин — без выдуманных обещаний.
 *
 * Держим описание в 70–160 символах: короче — выдача обрезает, длиннее — поисковик
 * обрезает сам и тавтологию «… Увлажняющая сыворотка для лица с гиалуронной кислотой…»
 * в хвосте описания только мешает.
 */
const DESC_MIN = 70;
const DESC_MAX = 160;
const DESC_TAIL = " — уход и косметика VIA LABOTE с доставкой по России.";

export function productMetaDescription(base: string | null | undefined, title: string): string {
  const text = (base || "").trim();
  if (text.length >= DESC_MIN && text.length <= DESC_MAX) return text;
  if (text.length > DESC_MAX) return `${text.slice(0, DESC_MAX - 1).trimEnd()}…`;
  // Подзаголовок короткий: хвост про магазин делает описание осмысленным.
  const withTail = text ? `${text}${DESC_TAIL}` : `${title}.${DESC_TAIL}`;
  return withTail;
}

/**
 * Title товара для выдачи — не длиннее 70 символов.
 *
 * Название из карточки бывает длиннее: «Увлажняющая сыворотка для лица с
 * гиалуроновой кислотой 8 в 1 — Via Labote» — это 73 символа. Поисковик режет
 * такой title по границе слова, и в выдаче остаётся обрывок без «8 в 1».
 *
 * Ручные варианты заданы для товаров, чьё название с признаком в title не влезает;
 * остальные ужимаются по границе слова, а бренд в конце остаётся.
 */
const TITLE_MAX = 70;
const TITLE_SUFFIX = " — Via Labote";

const PRODUCT_TITLE_OVERRIDES: Record<string, string> = {
  // Название из карточки: 60 символов + «8 в 1» не влезают вместе с брендом.
  "serum-8-in-1-white-tea": "Сыворотка для лица с гиалуроновой кислотой 8 в 1 — Via Labote",
};

/** Обрезает текст по границе слова, чтобы он влез в лимит. */
function fitTitle(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

export function productSeoTitle(product: { slug: string; title: string }): string {
  const override = PRODUCT_TITLE_OVERRIDES[product.slug];
  if (override) return override;
  const full = `${product.title}${TITLE_SUFFIX}`;
  if (full.length <= TITLE_MAX) return full;
  return `${fitTitle(product.title, TITLE_MAX - TITLE_SUFFIX.length)}${TITLE_SUFFIX}`;
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
