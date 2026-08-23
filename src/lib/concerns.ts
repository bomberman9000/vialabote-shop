// Статическая карта "потребность → товары". Не отдельная модель в БД —
// на 6 SKU полноценная taxonomy избыточна (см. отчёт). Каждая потребность
// подтверждена реальным составом/назначением товара, ничего не выдумано.
export interface Concern {
  slug: string;
  title: string;
  productSlugs: string[];
  image: string;
}

export const CONCERNS: Concern[] = [
  {
    slug: "acne",
    title: "Акне и несовершенства",
    productSlugs: ["multi3-anti-acne-serum"],
    image: "/images/products/antiaa2.webp",
  },
  {
    slug: "anti-age",
    title: "Anti-age и упругость",
    productSlugs: ["inci-retinal-serum"],
    image: "/images/products/retinal23.webp",
  },
  {
    slug: "hydration",
    title: "Увлажнение",
    productSlugs: ["serum-8-in-1-white-tea", "hydrophilic-gel-oil"],
    image: "/images/products/8in1.webp",
  },
  {
    slug: "glow",
    title: "Сияние и тон кожи",
    productSlugs: ["serum-resveratrol-vitamin-c"],
    image: "/images/products/rastrovetrol2.webp",
  },
  {
    slug: "men",
    title: "Мужской уход",
    productSlugs: ["beard-oil-steblev"],
    image: "/images/products/maslob2.webp",
  },
];

export function getConcern(slug: string | undefined): Concern | undefined {
  return CONCERNS.find((c) => c.slug === slug);
}
