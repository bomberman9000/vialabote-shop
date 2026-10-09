"use client";

import { useEffect, useRef } from "react";

// Мягкое появление секции при прокрутке: opacity 0→1 + translateY 16px→0.
// Без библиотек — IntersectionObserver + CSS (globals.css, [data-reveal]).
// Контент видим по умолчанию (SSR, без JS); скрываем только то, что после
// монтирования ещё ниже первого экрана, — поэтому LCP/CLS не страдают.
// prefers-reduced-motion: CSS сразу показывает без перехода.
export function Reveal({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;

    el.dataset.reveal = "pending";
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.dataset.reveal = "shown";
            io.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
