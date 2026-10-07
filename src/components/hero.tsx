import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Sparkles } from "lucide-react";
import { RoutineFinderTrigger } from "@/components/routine-finder/routine-finder-trigger";

// Hero — один готовый рекламный баннер (2001×786): модель, фон, заголовок,
// описание и нарисованные CTA уже в картинке. Поверх ничего не рисуем, только
// прозрачные hit-area на месте нарисованных кнопок.
//
// xl+ (≥1280px): баннер целиком по ширине экрана. Верхние 100px исходника (логотип
// бренда) срезаны — тот же логотип стоит в шапке сайта прямо над hero.
// Ниже xl вшитый текст становится нечитаемо мелким, поэтому показываем
// правую часть кадра (лицо, без вшитого текста) 4:3, а заголовок и кнопки —
// настоящим HTML. На xl+ заголовок/описание остаются только для screen reader
// (sr-only), а HTML-кнопки скрыты (их роль берут hit-area): визуально текст и
// кнопки не дублируются ни на одной ширине.
//
// Координаты hit-area — в % от видимой (обрезанной) области баннера,
// замерены по пикселям исходника: «Смотреть каталог» x 152–441, «Подобрать
// уход» x 458–729, обе y 628–686; с запасом 2px на сторону.
const BANNER = { width: 2001, height: 786, cropTop: 100 };
const VISIBLE_H = BANNER.height - BANNER.cropTop;
const pct = (v: number, total: number) => `${((v / total) * 100).toFixed(3)}%`;
const hitArea = (x0: number, x1: number, y0: number, y1: number) => ({
  left: pct(x0, BANNER.width),
  width: pct(x1 - x0, BANNER.width),
  top: pct(y0 - BANNER.cropTop, VISIBLE_H),
  height: pct(y1 - y0, VISIBLE_H),
});
const CATALOG_HIT = hitArea(150, 443, 626, 688);
const CARE_HIT = hitArea(456, 731, 626, 688);

const HIT_CLASS =
  "absolute hidden cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F7F1E6] xl:block";

export function Hero() {
  return (
    <section className="relative -mx-4 -mt-8 grid items-center gap-6 bg-[#F7F1E6] px-5 pb-6 pt-6 sm:px-8 md:grid-cols-2 md:gap-8 md:py-10 xl:-mx-[calc((100vw-100%)/2)] xl:block xl:p-0">
      <div className="flex flex-col gap-3 sm:gap-4">
        {/* Заголовок и описание: видимы ниже xl, на xl+ — только для screen reader */}
        <div className="flex flex-col gap-3 sm:gap-4 xl:sr-only">
          <h1 className="max-w-[15ch] text-[1.8rem] font-extrabold leading-[1.08] tracking-[-0.01em] text-brand-900 sm:text-[2.6rem]">
            Персональная формула вашей кожи
          </h1>
          <p className="text-lg font-medium text-gold-500 sm:text-xl">Наука. Природа. Гармония.</p>
          <p className="max-w-[38ch] text-sm leading-relaxed text-brand-600 sm:text-[15px]">
            Эффективные формулы с активными компонентами для красоты и здоровья кожи каждый день.
          </p>
        </div>
        {/* HTML-кнопки только ниже xl; на xl+ их заменяют hit-area на баннере */}
        <div className="mt-2 flex flex-wrap gap-3 xl:hidden">
          <Link
            href="/catalog"
            className="inline-flex items-center gap-2.5 rounded-md bg-brand-900 px-6 py-3.5 text-xs font-bold uppercase tracking-[0.06em] text-white transition-colors hover:bg-brand-800 sm:text-[13px]"
          >
            Смотреть каталог
            <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
          </Link>
          <RoutineFinderTrigger className="inline-flex items-center gap-2.5 rounded-md border border-gold-400 px-6 py-3.5 text-xs font-bold uppercase tracking-[0.06em] text-gold-500 transition-colors hover:bg-gold-50 sm:text-[13px]">
            Подобрать уход
            <Sparkles size={15} strokeWidth={1.8} aria-hidden="true" />
          </RoutineFinderTrigger>
        </div>
      </div>

      {/* Баннер: ниже xl — кадр с лицом 4:3, на xl+ — целиком без логотипа */}
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl xl:aspect-[2001/686] xl:rounded-none">
        <Image
          src="/images/hero/vialabote-hero.jpg"
          alt="Via Labote — персональная формула вашей кожи"
          fill
          priority
          sizes="(min-width: 1280px) 100vw, (min-width: 768px) 50vw, 100vw"
          className="object-cover object-right xl:object-bottom"
        />
        <Link href="/catalog" aria-label="Смотреть каталог" className={HIT_CLASS} style={CATALOG_HIT} />
        <RoutineFinderTrigger aria-label="Подобрать уход" className={HIT_CLASS} style={CARE_HIT}>
          <span className="sr-only">Подобрать уход</span>
        </RoutineFinderTrigger>
      </div>
    </section>
  );
}
