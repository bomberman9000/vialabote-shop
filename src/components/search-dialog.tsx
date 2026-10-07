"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowRight, Search, X } from "lucide-react";
import { AccessibleDialog } from "@/components/routine-finder/accessible-dialog";
import { formatPrice } from "@/lib/money";
import { searchProducts, type SearchProduct } from "@/lib/search";

const DEBOUNCE_MS = 150;

// Поиск по витрине: combobox + listbox (WAI-ARIA), ↑/↓ — выбор, Enter —
// открыть товар, Escape — закрыть (нативный <dialog>). Индекс приходит с
// сервера (getSearchProducts), поэтому отдельный API не нужен.
export function SearchDialog({
  open,
  onClose,
  products,
}: {
  open: boolean;
  onClose: () => void;
  products: SearchProduct[];
}) {
  const router = useRouter();
  const titleId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebounced("");
      setActive(0);
    } else {
      // фокус в поле сразу после showModal()
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => searchProducts(products, debounced), [products, debounced]);
  useEffect(() => setActive(0), [debounced]);

  function go(product: SearchProduct) {
    onClose();
    router.push(`/product/${product.slug}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active]);
    }
  }

  const hasQuery = debounced.trim().length > 0;

  return (
    <AccessibleDialog open={open} onClose={onClose} labelledBy={titleId} variant="search">
      <h2 id={titleId} className="sr-only">
        Поиск по каталогу
      </h2>
      <div className="flex items-center gap-3 border-b border-brand-100 px-5 py-4 sm:px-6">
        <Search size={20} strokeWidth={1.6} className="shrink-0 text-brand-400" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          inputMode="search"
          enterKeyHint="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Сыворотка, ретиналь, увлажнение…"
          aria-label="Поиск товаров"
          role="combobox"
          aria-expanded={hasQuery && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results.length > 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-base text-brand-900 outline-none placeholder:text-brand-300"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть поиск"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-brand-500 transition-colors hover:bg-brand-100 hover:text-brand-900"
        >
          <X size={20} strokeWidth={1.6} aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
        {!hasQuery ? (
          <p className="px-3 py-6 text-sm text-brand-500">
            Ищите по названию, назначению или активному компоненту.
          </p>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-start gap-3 px-3 py-6">
            <p className="text-sm text-brand-600">
              По запросу «{debounced}» ничего не нашлось.
            </p>
            <Link
              href="/catalog"
              onClick={onClose}
              className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-brand-900 hover:text-gold-500"
            >
              Смотреть весь каталог
              <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
            </Link>
          </div>
        ) : (
          <ul id={listId} role="listbox" aria-label="Результаты поиска" className="flex flex-col gap-1">
            {results.map((p, i) => (
              <li
                key={p.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(p)}
                className={`flex cursor-pointer items-center gap-4 rounded-xl p-2 transition-colors ${
                  i === active ? "bg-white" : ""
                }`}
              >
                <div className="vl-stage relative aspect-[3/4] w-14 shrink-0 overflow-hidden rounded-lg">
                  <Image src={p.imageUrl} alt="" fill className="object-contain" sizes="56px" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-brand-900">{p.title}</p>
                  {p.subtitle ? <p className="truncate text-xs text-brand-500">{p.subtitle}</p> : null}
                </div>
                <p className="shrink-0 text-sm font-bold tabular-nums text-brand-900">{formatPrice(p.price)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AccessibleDialog>
  );
}
