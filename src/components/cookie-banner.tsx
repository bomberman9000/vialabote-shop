"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const KEY = "cookie-consent";

export function CookieBanner() {
  const [choice, setChoice] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    try {
      setChoice(localStorage.getItem(KEY));
    } catch {
      setChoice(null);
    }
  }, []);

  useEffect(() => {
    // Аналитика загружается только после явного согласия.
    const id = process.env.NEXT_PUBLIC_METRIKA_ID;
    if (choice !== "accepted" || !id || document.getElementById("metrika-script")) return;
    const s = document.createElement("script");
    s.id = "metrika-script";
    s.async = true;
    s.src = "https://mc.yandex.ru/metrika/tag.js";
    s.onload = () => {
      (window as unknown as { ym?: (...a: unknown[]) => void }).ym?.(Number(id), "init", {});
    };
    document.head.appendChild(s);
  }, [choice]);

  function save(v: "accepted" | "declined") {
    try {
      localStorage.setItem(KEY, v);
    } catch {}
    setChoice(v);
  }

  if (choice !== null) return null;

  return (
    <div role="dialog" aria-label="Cookie" className="fixed inset-x-0 bottom-0 z-50 border-t border-brand-200 bg-white p-4 shadow-lg">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 text-sm md:flex-row md:items-center md:justify-between">
        <p>
          Мы используем cookie для работы сайта и, с вашего согласия, для аналитики.{" "}
          <Link href="/privacy" className="underline">Политика обработки данных</Link>
        </p>
        <div className="flex gap-2">
          <button type="button" className="btn-outline" onClick={() => save("declined")}>Отклонить</button>
          <button type="button" className="btn-primary" onClick={() => save("accepted")}>Принять</button>
        </div>
      </div>
    </div>
  );
}
