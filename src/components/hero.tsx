import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Sparkles } from "lucide-react";
import { RoutineFinderTrigger } from "@/components/routine-finder/routine-finder-trigger";

// Hero V2: настоящий HTML-текст + фото без вшитого текста.
//
// Фото — правая часть брендового баннера (x ≥ 760 из 2001×786, справа от
// нарисованных кнопок; см. assets/product-media/PRODUCT-MEDIA-MANIFEST.md),
// фон слева — тот же кремовый тон, что у баннера (#F4E8DB, замерен), поэтому
// композиция совпадает с прежней, но заголовок/кнопки — живые элементы:
// доступность, SEO, редактируемость, нормальный mobile.
//
// lg+: копия слева в контейнере, фото — правые 64% ширины экрана, левый край
// растворяется маской; лицо начинается правее конца текстовой колонки на
// всех ширинах от 1024px — текст лицо не перекрывает.
// < lg: фото сверху (кадр с лицом), текст и кнопки под ним.
const CREAM = "#F4E8DB";

export function Hero() {
  return (
    <section
      className="relative -mx-4 -mt-8 overflow-hidden lg:-mx-[calc((100vw-100%)/2)]"
      style={{ backgroundColor: CREAM }}
    >
      <div className="relative mx-auto flex max-w-7xl flex-col lg:min-h-[clamp(520px,42vw,680px)] lg:flex-row lg:items-center">
        <div className="relative aspect-[4/3] w-full sm:aspect-[16/9] lg:absolute lg:inset-y-0 lg:left-auto lg:right-[calc((100%-100vw)/2)] lg:aspect-auto lg:w-[64vw]">
          <Image
            src="/images/hero/vialabote-hero-beauty.jpg"
            alt="Модель VIA LABOTE с сияющей ухоженной кожей"
            fill
            priority
            sizes="(min-width: 1024px) 64vw, 100vw"
            className="object-cover object-[50%_28%] lg:object-[38%_center] lg:[mask-image:linear-gradient(to_right,transparent,black_26%)]"
          />
        </div>

        <div className="relative z-10 flex flex-col gap-4 px-5 pb-10 pt-7 sm:px-8 lg:w-[44%] lg:py-16 lg:pl-6 lg:pr-0">
          <h1 className="max-w-[14ch] text-[2rem] font-extrabold leading-[1.06] tracking-[-0.015em] text-brand-900 sm:text-[2.75rem] lg:text-[clamp(2.6rem,3.6vw,3.6rem)]">
            Персональная формула вашей кожи
          </h1>
          <p className="text-lg font-medium text-gold-500 sm:text-xl">Наука. Природа. Гармония.</p>
          <p className="max-w-[40ch] text-[15px] leading-relaxed text-brand-600 sm:text-base">
            Эффективные формулы с активными компонентами для красоты и здоровья кожи каждый день.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Link
              href="/catalog"
              className="group inline-flex min-h-12 items-center gap-2.5 rounded-md bg-brand-900 px-6 text-xs font-bold uppercase tracking-[0.08em] text-white transition-colors duration-200 hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 sm:text-[13px]"
            >
              Смотреть каталог
              <ArrowRight size={16} strokeWidth={2} aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <RoutineFinderTrigger className="group inline-flex min-h-12 items-center gap-2.5 rounded-md border border-gold-400 bg-[#FAF6EE]/40 px-6 text-xs font-bold uppercase tracking-[0.08em] text-gold-600 transition-colors duration-200 hover:bg-gold-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 sm:text-[13px]">
              Подобрать уход
              <Sparkles size={15} strokeWidth={1.8} aria-hidden="true" className="transition-transform duration-200 group-hover:rotate-12" />
            </RoutineFinderTrigger>
          </div>
        </div>
      </div>
    </section>
  );
}
