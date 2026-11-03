"use client";

import Link from "next/link";
import { Gift } from "lucide-react";
import { formatPrice } from "@/lib/money";
import { BUNDLE_ITEM_NAMES } from "@/lib/bundles";
import { useCartTotals } from "@/lib/use-cart-totals";

/** Сработавшие наборы (−N ₽) и подсказки «добавьте X — получите −10% на набор». */
export function CartBundles({ className = "" }: { className?: string }) {
  const { applied, almost } = useCartTotals();
  if (applied.length === 0 && almost.length === 0) return null;
  return (
    <div className={`flex w-full flex-col gap-1.5 text-sm ${className}`}>
      {applied.map((a, i) => (
        <div key={`${a.id}-${i}`} className="flex justify-between gap-3 text-emerald-700">
          <span>
            Набор «{a.title}» −{a.percent}%
          </span>
          <span className="shrink-0 font-medium">−{formatPrice(a.discount)}</span>
        </div>
      ))}
      {almost.slice(0, 2).map((b) => (
        <p key={b.id} className="inline-flex items-start gap-2 text-brand-700">
          <Gift size={16} strokeWidth={1.6} aria-hidden="true" className="mt-0.5 shrink-0 text-gold-500" />
          <span>
            Добавьте{" "}
            <Link href={`/product/${b.missing[0]}`} className="font-medium text-brand-900 underline">
              {BUNDLE_ITEM_NAMES[b.missing[0]] ?? "товар"}
            </Link>{" "}
            — и получите −{b.percent}% на набор «{b.title}»
          </span>
        </p>
      ))}
    </div>
  );
}
