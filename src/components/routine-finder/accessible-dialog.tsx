"use client";

import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: React.ReactNode;
}

/**
 * Обёртка над нативным <dialog>. showModal()/close() дают focus trap,
 * Escape-to-close и возврат фокуса на triggering-элемент "из коробки" —
 * поэтому не собираем вручную div+position:fixed для самой семантики модалки.
 * Позиционирование делаем сами (fixed inset-0 + flex), не полагаясь на
 * браузерное UA-центрирование — оно даёт мелкий "остров" на мобиле вместо
 * full-screen/bottom-sheet.
 */
export function AccessibleDialog({ open, onClose, labelledBy, children }: Props) {
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

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      className="fixed inset-0 z-50 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-brand-900/60"
      onClose={onClose}
    >
      {open ? (
        <div
          className="flex h-full w-full items-end justify-center sm:items-center sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl sm:max-h-[85vh] sm:max-w-lg sm:rounded-2xl sm:p-8">
            {children}
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
