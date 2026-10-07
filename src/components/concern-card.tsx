import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";

export interface ConcernCardData {
  slug: string;
  title: string;
  image: string;
}

// Карточка потребности («Акне», «Сухость»...) — навигационная, не товарная:
// фото на всю площадь, название поверх затемнения, без цены и кнопки
// корзины. Та же скруглённость и палитра, что у ProductCard, но читается как
// «раздел», а не как товар. Данные — из Concern в БД (см. главную).
export function ConcernCard({ concern }: { concern: ConcernCardData }) {
  return (
    <Link
      href={`/catalog?concern=${concern.slug}`}
      className="group relative block aspect-[4/5] overflow-hidden rounded-2xl bg-brand-900 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-4 focus-visible:ring-offset-[#FAF6EE]"
    >
      <Image
        src={concern.image}
        alt=""
        fill
        className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
        sizes="(min-width: 1024px) 20vw, (min-width: 768px) 33vw, 50vw"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-brand-900/85 via-brand-900/25 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 p-4 sm:p-5">
        <span className="text-[15px] font-bold leading-snug text-white sm:text-base">{concern.title}</span>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-gold-200">
          Смотреть
          <ArrowRight
            size={13}
            strokeWidth={2}
            aria-hidden="true"
            className="transition-transform group-hover:translate-x-0.5"
          />
        </span>
      </div>
    </Link>
  );
}
