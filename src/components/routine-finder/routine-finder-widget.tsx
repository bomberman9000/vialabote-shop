"use client";

import Link from "next/link";
import Image from "next/image";
import { CONCERNS, SCOPES, SKIN_TYPES } from "@/lib/routine-engine";
import { formatPrice } from "@/lib/money";
import { useCart } from "@/lib/cart-context";
import { AccessibleDialog } from "./accessible-dialog";
import { useRoutineFinder } from "./routine-finder-context";

const ROLE_LABELS: Record<string, string> = {
  cleanse: "Очищение",
  active: "Активный уход",
  care: "Уход",
};

function StepOptions({
  options,
  value,
  onSelect,
}: {
  options: { slug: string; name: string }[];
  value: string | undefined;
  onSelect: (slug: string) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((opt) => (
        <button
          key={opt.slug}
          type="button"
          aria-pressed={value === opt.slug}
          onClick={() => onSelect(opt.slug)}
          className={`rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
            value === opt.slug
              ? "border-brand-800 bg-brand-800 text-white"
              : "border-brand-200 text-brand-700 hover:border-brand-400"
          }`}
        >
          {opt.name}
        </button>
      ))}
    </div>
  );
}

function FinderFooter({
  step,
  onBack,
  onNext,
  canGoNext,
  onRestart,
}: {
  step: number;
  onBack: () => void;
  onNext: () => void;
  canGoNext: boolean;
  onRestart: () => void;
}) {
  return (
    <div className="mt-6 flex items-center justify-between">
      {step > 1 ? (
        <button type="button" onClick={onBack} className="btn-outline">
          Назад
        </button>
      ) : (
        <span />
      )}
      {step === 4 ? (
        <button type="button" onClick={onRestart} className="btn-outline">
          Начать заново
        </button>
      ) : (
        <button type="button" onClick={onNext} disabled={!canGoNext} className="btn-primary disabled:opacity-40">
          Продолжить
        </button>
      )}
    </div>
  );
}

export function RoutineFinderWidget() {
  const { isOpen, close, step, answers, setAnswer, goNext, goBack, restart, canGoNext, result } =
    useRoutineFinder();
  const { addItem } = useCart();

  const titleId = "routine-finder-title";

  return (
    <AccessibleDialog open={isOpen} onClose={close} labelledBy={titleId}>
      <div className="flex items-center justify-between">
        <h2 id={titleId} className="font-display text-xl text-brand-800">
          Подобрать уход
        </h2>
        <button
          type="button"
          onClick={close}
          aria-label="Закрыть"
          className="flex h-8 w-8 items-center justify-center rounded-full text-brand-500 hover:bg-brand-100"
        >
          ✕
        </button>
      </div>

      {step === 1 ? (
        <div className="mt-4">
          <p className="mb-3 text-sm text-brand-600">Что вас беспокоит?</p>
          <StepOptions
            options={[...CONCERNS]}
            value={answers.concern}
            onSelect={(slug) => setAnswer("concern", slug)}
          />
        </div>
      ) : null}

      {step === 2 ? (
        <div className="mt-4">
          <p className="mb-3 text-sm text-brand-600">Какой у вас тип кожи?</p>
          <StepOptions
            options={[...SKIN_TYPES]}
            value={answers.skinType}
            onSelect={(slug) => setAnswer("skinType", slug)}
          />
        </div>
      ) : null}

      {step === 3 ? (
        <div className="mt-4">
          <p className="mb-3 text-sm text-brand-600">Какой объём ухода вам нужен?</p>
          <StepOptions
            options={SCOPES.map((s) => ({ slug: s.value, name: s.name }))}
            value={answers.scope}
            onSelect={(slug) => setAnswer("scope", slug)}
          />
        </div>
      ) : null}

      {step === 4 ? (
        <div className="mt-4">
          {result && !result.isEmpty ? (
            <>
              <p className="mb-4 text-sm text-brand-600">Ваш уход Vialabote:</p>
              <div className="flex flex-col gap-4">
                {result.steps.map((s) => (
                  <div key={s.product.id} className="card flex gap-4 p-4">
                    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-brand-50">
                      <Image
                        src={s.product.imageUrl}
                        alt={s.product.title}
                        fill
                        className="object-contain p-2"
                        sizes="80px"
                      />
                    </div>
                    <div className="flex-1">
                      <span className="text-xs uppercase tracking-wide text-gold-600">
                        Шаг {s.step} · {ROLE_LABELS[s.role] ?? s.role}
                      </span>
                      <p className="font-medium text-brand-800">{s.product.title}</p>
                      <p className="mt-1 text-xs text-brand-500">{s.reason}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="font-semibold text-brand-800">
                          {formatPrice(s.product.price)}
                        </span>
                        <div className="flex gap-2">
                          <Link
                            href={`/product/${s.product.slug}`}
                            onClick={close}
                            className="text-xs text-brand-600 hover:underline"
                          >
                            Посмотреть
                          </Link>
                          <button
                            type="button"
                            className="rounded-full bg-brand-900 px-3 py-1 text-xs text-gold-200 hover:bg-brand-800"
                            disabled={s.product.stock <= 0}
                            onClick={() =>
                              addItem({
                                productId: s.product.id,
                                slug: s.product.slug,
                                title: s.product.title,
                                price: s.product.price,
                                imageUrl: s.product.imageUrl,
                              })
                            }
                          >
                            В корзину
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-start gap-3">
              <p className="text-brand-700">
                Мы не нашли точного набора под выбранные параметры.
              </p>
              <div className="flex gap-3">
                <button type="button" onClick={goBack} className="btn-outline">
                  Изменить ответы
                </button>
                <Link href="/catalog" onClick={close} className="btn-primary">
                  Смотреть каталог
                </Link>
              </div>
            </div>
          )}
        </div>
      ) : null}

      <FinderFooter step={step} onBack={goBack} onNext={goNext} canGoNext={canGoNext} onRestart={restart} />
    </AccessibleDialog>
  );
}
