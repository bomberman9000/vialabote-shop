"use client";

import { useEffect, useRef } from "react";

type Variant = "sheet" | "drawer" | "search";

interface Props {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: React.ReactNode;
  /**
   * sheet  — bottom-sheet на телефоне, карточка по центру на desktop (Routine Finder);
   * drawer — панель слева на всю высоту (мобильное меню);
   * search — панель сверху (поиск).
   */
  variant?: Variant;
}

const LAYOUT: Record<Variant, { wrap: string; panel: string }> = {
  sheet: {
    wrap: "items-end justify-center sm:items-center sm:p-6",
    panel:
      "vl-dialog-sheet max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl sm:max-h-[85vh] sm:max-w-lg sm:rounded-2xl sm:p-8",
  },
  drawer: {
    wrap: "items-stretch justify-start",
    panel: "vl-dialog-drawer flex h-full w-[min(86vw,360px)] flex-col overflow-y-auto bg-[#FAF6EE] shadow-xl",
  },
  search: {
    wrap: "items-start justify-center sm:px-6 sm:pt-[8vh]",
    panel:
      "vl-dialog-search flex max-h-[100dvh] w-full flex-col overflow-hidden bg-[#FAF6EE] shadow-xl sm:max-h-[80vh] sm:max-w-2xl sm:rounded-2xl",
  },
};

/**
 * Обёртка над нативным <dialog>. showModal()/close() дают focus trap,
 * Escape-to-close и возврат фокуса на triggering-элемент "из коробки" —
 * поэтому не собираем вручную div+position:fixed для самой семантики модалки.
 * Позиционирование делаем сами (fixed inset-0 + flex), не полагаясь на
 * браузерное UA-центрирование — оно даёт мелкий "остров" на мобиле вместо
 * full-screen/bottom-sheet. Появление — CSS-анимация (opacity + translate),
 * отключается при prefers-reduced-motion (см. globals.css).
 */
export function AccessibleDialog({ open, onClose, labelledBy, children, variant = "sheet" }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      document.body.style.overflow = "hidden";
    } else if (!open && dialog.open) {
      dialog.close();
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const layout = LAYOUT[variant];

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      className="vl-dialog fixed inset-0 z-50 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-brand-900/60"
      onClose={onClose}
    >
      {open ? (
        <div
          className={`flex h-full w-full ${layout.wrap}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div className={layout.panel}>{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}
