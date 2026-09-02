import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Sparkles } from "lucide-react";
import { RoutineFinderTrigger } from "@/components/routine-finder/routine-finder-trigger";

// Реальные фотографии товаров (controlled crop, упаковка/этикетки/крышки не
// изменены — см. scripts в истории подготовки ассетов). Автоматическое удаление
// фона на этих снимках повреждало прозрачные колпачки, поэтому не применялось:
// у карточек родной студийный фон с эллиптической растушёвкой краёв.
//
// heightPct — высота КАРТОЧКИ в % от контейнера ряда; подобрана так, чтобы сам
// флакон получил высоту, пропорциональную реальному размеру упаковки
// (серумы 50 мл ≈ 11 см, гель-масло 150 мл ≈ 16.5 см).
// baselineShift — сдвиг вниз на долю собственной высоты: в кадре под донышком
// остаётся запас, и без сдвига флаконы «висели» бы над общей линией.
const HERO_BOTTLES = [
  {
    image: "/images/products/cutouts/rastrovetrol2-card.png",
    alt: "Сыворотка Ресвератрол + Витамин C",
    ratio: "594 / 1552",
    heightPct: "66.6%",
    baselineShift: "4.6%",
    z: 2,
  },
  {
    image: "/images/products/cutouts/retinal23-card.png",
    alt: "INCI Retinal Serum",
    ratio: "572 / 1509",
    heightPct: "66.7%",
    baselineShift: "4.8%",
    z: 3,
  },
  {
    image: "/images/products/cutouts/8in1-card.png",
    alt: "Сыворотка 8 in 1 White Tea",
    ratio: "550 / 1440",
    heightPct: "66.9%",
    baselineShift: "5.0%",
    z: 4,
  },
  {
    image: "/images/products/cutouts/gidrofil-card.png",
    alt: "Гидрофильное гель-масло",
    ratio: "550 / 1288",
    heightPct: "100%",
    baselineShift: "4.7%",
    z: 3,
  },
  {
    image: "/images/products/cutouts/antiaa2-card.png",
    alt: "Multi3 Anti-Acne Serum",
    ratio: "590 / 1569",
    heightPct: "63.6%",
    baselineShift: "4.6%",
    z: 2,
  },
];

export function Hero() {
  return (
    <section className="relative -mt-8 overflow-hidden bg-[#F7F1E6] md:-mx-[calc((100vw-100%)/2)] md:px-[calc((100vw-100%)/2)]">
      <div className="relative mx-auto flex min-h-0 max-w-7xl flex-col md:min-h-[600px] md:flex-row">
        {/* МОДЕЛЬ — уходит в правый край страницы, мягко растворяется в фоне слева */}
        <div className="absolute inset-y-0 right-0 hidden w-[62%] md:block">
          <Image
            src="/images/hero-main.webp"
            alt="Модель Vialabote"
            fill
            className="object-cover object-[72%_20%]"
            sizes="60vw"
            priority
          />
          {/* растворение фотографии в кремовый фон — без жёсткого края карточки */}
          <div className="absolute inset-0 bg-gradient-to-r from-[#F7F1E6] via-[#F7F1E6]/55 via-30% to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-[#F7F1E6]/70 to-transparent" />
        </div>

        {/* КОПИЯ — левая колонка */}
        <div className="relative z-20 flex flex-col justify-center gap-3 px-5 pb-2 pt-6 sm:gap-4 sm:px-8 md:w-[46%] md:py-0 md:pl-2 md:pr-0">
          <h1 className="max-w-[15ch] text-[1.8rem] font-extrabold leading-[1.08] tracking-[-0.01em] text-brand-900 sm:text-[2.6rem] md:text-[3.1rem]">
            Персональная формула вашей кожи
          </h1>
          <p className="text-lg font-medium text-gold-500 sm:text-xl">Наука. Природа. Гармония.</p>
          <p className="max-w-[38ch] text-sm leading-relaxed text-brand-600 sm:text-[15px]">
            Эффективные формулы с активными компонентами для красоты и здоровья кожи каждый день.
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <Link
              href="/catalog"
              className="inline-flex items-center gap-2.5 rounded-md bg-brand-900 px-6 py-3.5 text-xs font-bold uppercase tracking-[0.06em] text-white transition-colors hover:bg-brand-800 sm:text-[13px]"
            >
              Смотреть каталог
              <ArrowRight size={16} strokeWidth={2} />
            </Link>
            <RoutineFinderTrigger className="inline-flex items-center gap-2.5 rounded-md border border-gold-400 px-6 py-3.5 text-xs font-bold uppercase tracking-[0.06em] text-gold-500 transition-colors hover:bg-gold-50 sm:text-[13px]">
              Подобрать уход
              <Sparkles size={15} strokeWidth={1.8} />
            </RoutineFinderTrigger>
          </div>
        </div>

        {/* МОДЕЛЬ на мобильном — отдельным блоком под текстом */}
        <div className="relative mt-3 h-[40vw] min-h-[165px] w-full md:hidden">
          <Image
            src="/images/hero-main.webp"
            alt="Модель Vialabote"
            fill
            className="object-cover object-[72%_18%]"
            sizes="100vw"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#F7F1E6] via-transparent to-transparent" />
        </div>

        {/* ПРОДУКТЫ — крупный foreground перед моделью, стоят на общей поверхности */}
        <div className="pointer-events-none relative z-10 -mt-12 flex h-[34vw] max-h-[260px] min-h-[140px] w-full items-end justify-center px-4 pb-4 md:absolute md:bottom-[9%] md:left-[41%] md:top-[40%] md:mt-0 md:h-auto md:max-h-none md:w-[38%] md:px-0 md:pb-0">
          {/* поверхность-«полка»: общая мягкая тень под рядом */}
          <div className="absolute bottom-[-2%] left-[2%] right-[2%] h-[10%] rounded-[100%] bg-gradient-to-b from-black/25 to-transparent blur-md" />
          <div className="flex h-full w-full items-end justify-center gap-[0.5%]">
            {HERO_BOTTLES.map((bottle) => (
              <div
                key={bottle.image}
                className="relative flex-none"
                style={{
                  height: bottle.heightPct,
                  aspectRatio: bottle.ratio,
                  transform: `translateY(${bottle.baselineShift})`,
                  zIndex: bottle.z,
                }}
              >
                <Image
                  src={bottle.image}
                  alt={bottle.alt}
                  fill
                  className="object-contain object-bottom"
                  sizes="170px"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
