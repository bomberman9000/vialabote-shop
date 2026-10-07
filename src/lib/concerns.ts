// Витринные названия потребностей — тонкий слой поверх таблицы Concern.
//
// Источник истины по составу потребностей и по тому, какие товары в них
// попадают, — БД (Concern + ProductConcern). Слаг всегда канонический, из
// Concern.slug; никаких списков productSlugs здесь больше нет, иначе архивация
// товара оставляла бы на витрине плитку-призрак, а созданный в админке товар
// не мог бы в неё попасть без правки кода.
//
// Остаётся только витринная формулировка заголовка: у Routine Finder и у
// витрины разный язык для одного и того же слага ("Сухость" против
// "Увлажнение"). Для слага без override берётся Concern.name из БД — поэтому
// потребность, добавленная в БД, появляется на витрине сама.
export const CONCERN_DISPLAY_TITLES: Record<string, string> = {
  acne: "Акне и несовершенства",
  "anti-age": "Anti-age и упругость",
  dryness: "Увлажнение",
  "dull-tone": "Сияние и тон кожи",
  men: "Мужской уход",
};

export function concernTitle(concern: { slug: string; name: string }): string {
  return CONCERN_DISPLAY_TITLES[concern.slug] ?? concern.name;
}

// Визуальный слой карточек потребностей: абстрактные текстуры (вода, свет,
// упругость, чистота, структура) — без продуктов и упаковки, см.
// assets/product-media/concern/. Как и заголовки выше, это витринная
// подача поверх Concern из БД: потребность без записи здесь получает фото
// своего опубликованного товара (fallback), поэтому новая потребность из
// админки/Telegram отображается без правки кода.
export interface ConcernVisual {
  image: string;
  /** light — тёмный текст поверх светлой текстуры; dark — светлый текст */
  tone: "light" | "dark";
}

export const CONCERN_VISUALS: Record<string, ConcernVisual> = {
  acne: { image: "/images/concern/concern-acne.webp", tone: "light" },
  "anti-age": { image: "/images/concern/concern-anti-age.webp", tone: "light" },
  dryness: { image: "/images/concern/concern-dryness.webp", tone: "light" },
  "dull-tone": { image: "/images/concern/concern-dull-tone.webp", tone: "light" },
  men: { image: "/images/concern/concern-men.webp", tone: "dark" },
};
