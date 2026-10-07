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
