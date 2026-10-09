// Единый источник правды для тегов Routine Finder по каждому SKU.
// Используется и в prisma/seed.ts (наполнение БД), и в тестах валидации данных.
//
// ВАЖНО (честность данных — pre-commit hardening, см. отчёт):
// - concernSlugs выведены из СОБСТВЕННОГО реального описания/subtitle товара
//   (напр. Multi3 прямо описан как "сыворотка против акне") — это не гадание,
//   попадает в БД как есть.
// - skinTypeSlugs, которые реально уходят в БД (поле `skinTypeSlugs` ниже),
//   НАМЕРЕННО пустые для всех товаров: подходящий тип кожи ни для одного SKU
//   не подтверждён владельцем бренда/официальной документацией Vialabote.
//   Пустой массив в движке = "подходит всем типам" (см. routine-engine.ts) —
//   это безопасный дефолт, а не потерянные данные.
// - Черновой вывод типа кожи (`draftSkinTypeSlugs`) оставлен рядом ИСКЛЮЧИТЕЛЬНО
//   как справочный материал для владельца бренда — seed.ts его НЕ читает и
//   НЕ пишет в БД. Не использовать как production-факт, пока кто-то явно
//   не подтвердит и не перенесёт значения в `skinTypeSlugs`.
export interface RoutineTag {
  slug: string;
  concernSlugs: string[];
  skinTypeSlugs: string[]; // production-данные: сейчас всегда [] (не подтверждено)
  draftSkinTypeSlugs: string[]; // НЕ для БД — только черновая гипотеза на подтверждение
  routineStep: number;
  routineRole: "cleanse" | "active" | "care";
}

export const ROUTINE_TAGS: RoutineTag[] = [
  {
    slug: "hydrophilic-gel-oil",
    concernSlugs: [],
    skinTypeSlugs: [],
    draftSkinTypeSlugs: [], // очищающее масло — универсальный подготовительный шаг
    routineStep: 1,
    routineRole: "cleanse",
  },
  {
    slug: "multi3-anti-acne-serum",
    concernSlugs: ["acne"],
    skinTypeSlugs: [],
    draftSkinTypeSlugs: ["oily", "combination"],
    routineStep: 2,
    routineRole: "active",
  },
  {
    slug: "inci-retinal-serum",
    concernSlugs: ["anti-age"],
    skinTypeSlugs: [],
    draftSkinTypeSlugs: ["oily", "combination", "normal"],
    routineStep: 2,
    routineRole: "active",
  },
  {
    slug: "serum-resveratrol-vitamin-c",
    concernSlugs: ["dull-tone"],
    skinTypeSlugs: [],
    draftSkinTypeSlugs: ["oily", "dry", "combination", "normal"],
    routineStep: 2,
    routineRole: "active",
  },
  {
    slug: "serum-8-in-1-white-tea",
    concernSlugs: ["dryness"],
    skinTypeSlugs: [],
    draftSkinTypeSlugs: [], // гиалуроновая кислота — обычно хорошо переносится любой кожей
    routineStep: 2,
    routineRole: "active",
  },
  {
    slug: "beard-oil-steblev",
    concernSlugs: ["men"],
    skinTypeSlugs: [],
    draftSkinTypeSlugs: [],
    routineStep: 1,
    routineRole: "care",
  },
];
