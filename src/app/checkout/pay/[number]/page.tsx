"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCart } from "@/lib/cart-context";
import { formatPrice } from "@/lib/money";

interface PaymentState {
  number: string;
  status: string;
  totalAmount: number;
  expiresAt: string;
  serverNow: string;
  paymentUrl: string | null;
}

const WINDOW_SEC = 10 * 60;
const POLL_MS = 4_000;

function mmss(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function PayPage() {
  const params = useParams<{ number: string }>();
  const number = decodeURIComponent(params.number);
  const { clear } = useCart();
  const [state, setState] = useState<PaymentState | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const skew = useRef(0); // часы покупателя могут спешить: считаем время от сервера
  const cleared = useRef(false);

  async function load() {
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(number)}/payment`, { cache: "no-store" });
      if (res.status === 404) return setNotFound(true);
      if (!res.ok) return;
      const data = (await res.json()) as PaymentState;
      skew.current = new Date(data.serverNow).getTime() - Date.now();
      setState(data);
    } catch {
      /* сеть моргнула — следующий опрос повторит */
    }
  }

  useEffect(() => {
    load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [number]);

  const left = state ? (new Date(state.expiresAt).getTime() - (now + skew.current)) / 1000 : WINDOW_SEC;
  const awaiting = state?.status === "AWAITING_PAYMENT";
  const timeUp = awaiting && left <= 0;

  // время вышло — сразу спросить сервер, он отменит заказ и вернёт товар на склад
  const askedAfterExpiry = useRef(false);
  useEffect(() => {
    if (timeUp && !askedAfterExpiry.current) {
      askedAfterExpiry.current = true;
      setTimeout(load, 800);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeUp]);

  useEffect(() => {
    if (state?.status === "PAID" && !cleared.current) {
      cleared.current = true;
      clear();
    }
  }, [state?.status, clear]);

  const ring = useMemo(() => {
    const r = 92;
    const c = 2 * Math.PI * r;
    const frac = Math.min(1, Math.max(0, left / WINDOW_SEC));
    return { r, c, offset: c * (1 - frac) };
  }, [left]);

  if (notFound) {
    return (
      <Shell>
        <h1 className="font-display text-2xl text-brand-800">Заказ не найден</h1>
        <Link href="/catalog" className="btn-primary mt-6">
          В каталог
        </Link>
      </Shell>
    );
  }

  if (!state) {
    return (
      <Shell>
        <div className="h-56 w-56 animate-pulse rounded-full bg-brand-100" />
        <p className="mt-6 text-brand-500">Готовим оплату…</p>
      </Shell>
    );
  }

  if (state.status === "PAID") {
    return (
      <Shell>
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gold-100 text-5xl text-gold-600">✓</div>
        <h1 className="mt-6 font-display text-3xl text-brand-800">Оплата прошла</h1>
        <p className="mt-2 text-brand-600">
          Заказ <b>{state.number}</b> на {formatPrice(state.totalAmount)} оплачен. Мы свяжемся с вами, чтобы согласовать доставку.
        </p>
        <Link href="/catalog" className="btn-primary mt-8">
          Продолжить покупки
        </Link>
      </Shell>
    );
  }

  if (state.status === "CANCELLED" || timeUp) {
    return (
      <Shell>
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-brand-100 font-display text-4xl text-brand-400">
          00:00
        </div>
        <h1 className="mt-6 font-display text-3xl text-brand-800">Время на оплату вышло</h1>
        <p className="mt-2 max-w-sm text-brand-600">
          Заказ {state.number} отменён, товары вернулись в продажу. Корзина сохранена — оформите заказ ещё раз, это займёт минуту.
        </p>
        <Link href="/cart" className="btn-primary mt-8">
          Вернуться в корзину
        </Link>
      </Shell>
    );
  }

  if (!awaiting) {
    return (
      <Shell>
        <h1 className="font-display text-3xl text-brand-800">Заказ {state.number} принят</h1>
        <p className="mt-2 text-brand-600">Мы свяжемся с вами для подтверждения деталей.</p>
        <Link href="/catalog" className="btn-primary mt-8">
          В каталог
        </Link>
      </Shell>
    );
  }

  const urgent = left <= 60;
  return (
    <Shell>
      <p className="text-xs uppercase tracking-[0.25em] text-gold-500">Оплата заказа</p>
      <h1 className="mt-2 font-display text-3xl text-brand-800">{state.number}</h1>
      <p className="mt-1 text-2xl font-semibold text-brand-900">{formatPrice(state.totalAmount)}</p>

      <div className="relative mt-8 h-56 w-56" role="timer" aria-live="off" aria-label={`Осталось ${mmss(left)}`}>
        <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90">
          <circle cx="100" cy="100" r={ring.r} fill="none" strokeWidth="8" className="stroke-brand-100" />
          <circle
            cx="100"
            cy="100"
            r={ring.r}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={ring.c}
            strokeDashoffset={ring.offset}
            className={urgent ? "stroke-red-500 transition-[stroke-dashoffset] duration-300" : "stroke-gold-400 transition-[stroke-dashoffset] duration-300"}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-display text-5xl tabular-nums ${urgent ? "text-red-600 animate-pulse" : "text-brand-800"}`}>{mmss(left)}</span>
          <span className="mt-1 text-xs text-brand-500">осталось на оплату</span>
        </div>
      </div>

      <p className="mt-6 max-w-sm text-sm text-brand-600">
        Товары зарезервированы за вами. Если не оплатить за 10 минут, бронь снимется и товар вернётся в продажу.
      </p>

      {state.paymentUrl ? (
        <a href={state.paymentUrl} className="btn-primary mt-6 w-full max-w-sm py-4 text-base">
          Оплатить картой или по СБП
        </a>
      ) : (
        <p className="mt-6 text-sm text-brand-500">Ссылка на оплату готовится…</p>
      )}
      <p className="mt-3 text-xs text-brand-400">
        Оплата на защищённой странице Точка Банка. После оплаты вы вернётесь сюда — статус обновится сам.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="card mx-auto my-10 flex max-w-lg flex-col items-center px-6 py-12 text-center">{children}</div>;
}
