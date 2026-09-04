"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  matchRoutine,
  type RoutineProduct,
  type RoutineResult,
  type Scope,
} from "@/lib/routine-engine";

export type FinderStep = 1 | 2 | 3 | 4;

export interface FinderAnswers {
  concern?: string;
  skinType?: string;
  scope?: Scope;
}

interface FinderContextValue {
  isOpen: boolean;
  step: FinderStep;
  answers: FinderAnswers;
  result: RoutineResult | null;
  products: RoutineProduct[];
  open: () => void;
  close: () => void;
  setAnswer: (key: keyof FinderAnswers, value: string) => void;
  goNext: () => void;
  goBack: () => void;
  restart: () => void;
  canGoNext: boolean;
}

const FinderContext = createContext<FinderContextValue | null>(null);

const QUERY_KEYS = { concern: "rf_concern", skin: "rf_skin", scope: "rf_scope" } as const;

export function RoutineFinderProvider({
  products,
  children,
}: {
  products: RoutineProduct[];
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  // Query-строка читается из window.location, а НЕ через useSearchParams():
  // этот хук обязан жить под <Suspense>, а единственная доступная граница была
  // в корневом layout — она оборачивала {children}, из-за чего Next успевал
  // отдать shell со статусом 200 раньше, чем страница вызывала notFound(),
  // и любой несуществующий товар отдавал soft-404. Оба обращения ниже —
  // клиентские (эффект после монтирования и обработчик действия), на SSR не
  // выполняются, поэтому window здесь всегда определён.
  const readQuery = () =>
    new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);

  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<FinderStep>(1);
  const [answers, setAnswers] = useState<FinderAnswers>({});
  const [result, setResult] = useState<RoutineResult | null>(null);
  const [restoredFromUrl, setRestoredFromUrl] = useState(false);

  // Восстановление shareable-состояния из URL. Некорректные/неизвестные
  // значения молча игнорируются — matchRoutine сам вернёт isEmpty для них,
  // страница не падает.
  useEffect(() => {
    if (restoredFromUrl) return;
    const current = readQuery();
    const concern = current.get(QUERY_KEYS.concern);
    const skin = current.get(QUERY_KEYS.skin);
    const scope = current.get(QUERY_KEYS.scope);

    if (concern && skin && (scope === "minimal" || scope === "full")) {
      const restoredAnswers: FinderAnswers = { concern, skinType: skin, scope };
      const restoredResult = matchRoutine(
        { concern, skinType: skin, scope },
        products,
      );
      setAnswers(restoredAnswers);
      setResult(restoredResult);
      setStep(4);
      setIsOpen(true);
    }
    setRestoredFromUrl(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoredFromUrl]);

  function syncUrl(next: FinderAnswers | null) {
    const params = readQuery();
    if (next?.concern && next?.skinType && next?.scope) {
      params.set(QUERY_KEYS.concern, next.concern);
      params.set(QUERY_KEYS.skin, next.skinType);
      params.set(QUERY_KEYS.scope, next.scope);
    } else {
      params.delete(QUERY_KEYS.concern);
      params.delete(QUERY_KEYS.skin);
      params.delete(QUERY_KEYS.scope);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function open() {
    setIsOpen(true);
  }

  function close() {
    setIsOpen(false);
  }

  function setAnswer(key: keyof FinderAnswers, value: string) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  function goNext() {
    if (step === 3) {
      const finalAnswers = answers;
      if (!finalAnswers.concern || !finalAnswers.skinType || !finalAnswers.scope) return;
      const computed = matchRoutine(
        { concern: finalAnswers.concern, skinType: finalAnswers.skinType, scope: finalAnswers.scope },
        products,
      );
      setResult(computed);
      syncUrl(finalAnswers);
      setStep(4);
      return;
    }
    setStep((s) => (s < 4 ? ((s + 1) as FinderStep) : s));
  }

  function goBack() {
    if (step === 4) {
      // Возврат из результата к последнему вопросу — ответы сохраняются.
      setStep(3);
      return;
    }
    setStep((s) => (s > 1 ? ((s - 1) as FinderStep) : s));
  }

  function restart() {
    setAnswers({});
    setResult(null);
    setStep(1);
    syncUrl(null);
  }

  const canGoNext = useMemo(() => {
    if (step === 1) return Boolean(answers.concern);
    if (step === 2) return Boolean(answers.skinType);
    if (step === 3) return Boolean(answers.scope);
    return true;
  }, [step, answers]);

  const value: FinderContextValue = {
    isOpen,
    step,
    answers,
    result,
    products,
    open,
    close,
    setAnswer,
    goNext,
    goBack,
    restart,
    canGoNext,
  };

  return <FinderContext.Provider value={value}>{children}</FinderContext.Provider>;
}

export function useRoutineFinder(): FinderContextValue {
  const ctx = useContext(FinderContext);
  if (!ctx) throw new Error("useRoutineFinder должен использоваться внутри <RoutineFinderProvider>");
  return ctx;
}
