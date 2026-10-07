"use client";

import { useState } from "react";
import Image from "next/image";

export interface GalleryImage {
  url: string;
  alt: string;
}

// Галерея PDP: основное фото товара + доп. снимки из MediaAsset
// (PRODUCT_GALLERY), которые загружаются через админку/Telegram — компонент
// не знает, сколько их. Переключение — мягкий crossfade (CSS opacity), при
// prefers-reduced-motion — мгновенно. Одно фото → без миниатюр.
export function ProductGallery({ images, badge }: { images: GalleryImage[]; badge?: string | null }) {
  const [current, setCurrent] = useState(0);

  return (
    <div className="flex flex-col gap-3">
      <div className="vl-stage relative aspect-[4/5] w-full overflow-hidden rounded-2xl">
        {images.map((img, i) => (
          <Image
            key={img.url}
            src={img.url}
            alt={img.alt}
            fill
            priority={i === 0}
            sizes="(min-width: 1024px) 560px, 100vw"
            className={`object-contain transition-opacity duration-500 ease-out ${i === current ? "opacity-100" : "opacity-0"}`}
          />
        ))}
        {badge ? (
          <span className="absolute left-4 top-4 rounded-full bg-[#FAF6EE]/95 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-900">
            {badge}
          </span>
        ) : null}
      </div>
      {images.length > 1 ? (
        <div className="flex gap-2" role="group" aria-label="Фото товара">
          {images.map((img, i) => (
            <button
              key={img.url}
              type="button"
              onClick={() => setCurrent(i)}
              aria-label={`Фото ${i + 1} из ${images.length}`}
              aria-pressed={i === current}
              className={`vl-stage relative aspect-[4/5] w-16 overflow-hidden rounded-lg transition-[box-shadow,opacity] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 ${
                i === current ? "ring-1 ring-brand-900" : "opacity-70 hover:opacity-100"
              }`}
            >
              <Image src={img.url} alt="" fill sizes="64px" className="object-contain" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
