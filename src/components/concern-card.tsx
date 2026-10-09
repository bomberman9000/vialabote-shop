import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";

export interface ConcernCardData {
  slug: string;
  title: string;
  image: string;
  /** light — тёмный текст на светлой текстуре; dark — светлый текст на тёмной/фото */
  tone: "light" | "dark";
}

// Карточка потребности — навигация по результату, а не ещё один флакон:
// абстрактная текстура на всю площадь, крупное название, без цены/корзины.
// Та же скруглённость и палитра, что у ProductCard, но читается как «раздел».
export function ConcernCard({ concern, className = "" }: { concern: ConcernCardData; className?: string }) {
  const light = concern.tone === "light";
  return (
    <Link
      href={`/catalog?concern=${concern.slug}`}
      className={`group relative block min-h-[180px] overflow-hidden rounded-2xl bg-brand-900 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-4 focus-visible:ring-offset-[#FAF6EE] ${className}`}
    >
      <Image
        src={concern.image}
        alt=""
        fill
        className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
        sizes="(min-width: 1024px) 20vw, (min-width: 768px) 33vw, 50vw"
      />
      <div
        className={`absolute inset-0 transition-opacity duration-500 ${
          light
            ? "bg-gradient-to-t from-[#FAF6EE]/80 via-[#FAF6EE]/10 to-transparent opacity-90 group-hover:opacity-100"
            : "bg-gradient-to-t from-brand-900/85 via-brand-900/20 to-transparent opacity-90 group-hover:opacity-100"
        }`}
      />
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-4 sm:p-5">
        <span className={`text-base font-bold leading-snug sm:text-lg ${light ? "text-brand-900" : "text-white"}`}>
          {concern.title}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] ${
            light ? "text-gold-600" : "text-gold-200"
          }`}
        >
          Смотреть
          <ArrowRight
            size={13}
            strokeWidth={2}
            aria-hidden="true"
            className="transition-transform duration-300 group-hover:translate-x-1"
          />
        </span>
      </div>
    </Link>
  );
}

// Сетка потребностей: осознанная композиция, а не случайные «3 + 2».
// Телефон: первая плитка — широкая (2 колонки), дальше пары.
// Планшет: 6-колоночная сетка — первые три по 2 колонки, остальные по 3
// (для пяти потребностей: ряд из трёх и ряд из двух широких — «bento»).
// Desktop (lg+): все в один ряд.
export function ConcernGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={[
        "grid grid-cols-2 gap-3 sm:gap-4",
        "[&>*]:aspect-[4/5] [&>*:first-child]:col-span-2 [&>*:first-child]:aspect-[2/1]",
        "md:grid-cols-6 md:[&>*]:col-span-2 md:[&>*]:aspect-[4/5] md:[&>*:nth-child(n+4)]:col-span-3 md:[&>*:nth-child(n+4)]:aspect-[16/9] md:[&>*:first-child]:col-span-2 md:[&>*:first-child]:aspect-[4/5]",
        "lg:grid-flow-col lg:auto-cols-fr lg:grid-cols-none lg:[&>*]:col-span-1 lg:[&>*:nth-child(n+4)]:col-span-1 lg:[&>*]:aspect-[4/5] lg:[&>*:nth-child(n+4)]:aspect-[4/5] lg:[&>*:first-child]:col-span-1",
      ].join(" ")}
    >
      {children}
    </div>
  );
}
