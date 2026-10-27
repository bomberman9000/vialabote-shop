"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart-context";
import { formatPrice } from "@/lib/money";
import { formatDeliveryDate } from "@/lib/delivery/format";
import { OzonDelivery, type OzonSelection } from "./ozon-delivery";

export default function CheckoutPage() {
  const { items, totalAmount, clear } = useCart();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    deliveryCity: "",
    deliveryAddress: "",
    comment: "",
  });

  const [offer, setOffer] = useState(false);
  const [pdn, setPdn] = useState(false);
  const [ads, setAds] = useState(false);

  // Доставка Ozon показывается, только если она включена на сервере; иначе форма как раньше.
  const [ozonEnabled, setOzonEnabled] = useState(false);
  const [mode, setMode] = useState<"OZON_PVZ" | "MANUAL">("OZON_PVZ");
  const [ozon, setOzon] = useState<OzonSelection | null>(null);
  const [recipient, setRecipient] = useState({ lastName: "", firstName: "", middleName: "" });
  useEffect(() => {
    fetch("/api/delivery/ozon")
      .then((r) => r.json())
      .then((d) => setOzonEnabled(d.enabled === true))
      .catch(() => setOzonEnabled(false));
  }, []);
  const useOzon = ozonEnabled && mode === "OZON_PVZ";
  const deliveryPrice = useOzon && ozon ? ozon.quote.priceKopecks : 0;

  if (items.length === 0) {
    return <p className="text-brand-600">Корзина пуста. Добавьте товары в каталоге.</p>;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          ...(useOzon && ozon
            ? {
                deliveryCity: ozon.point.city ?? "—",
                deliveryAddress: `Пункт выдачи Ozon: ${ozon.point.address ?? ozon.point.id}`,
                delivery: {
                  provider: "OZON",
                  destination: { type: "PVZ", mapPointId: ozon.point.id },
                  recipient: {
                    lastName: recipient.lastName,
                    firstName: recipient.firstName,
                    ...(recipient.middleName ? { middleName: recipient.middleName } : {}),
                  },
                },
              }
            : {}),
          offerAccepted: offer,
          pdnConsent: pdn,
          adsConsent: ads,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        }),
      });
      const data = await res.json();

      if (data.paymentError) {
        // Банк не открыл оплату: заказ отменён, резерв снят — корзину не трогаем, можно повторить.
        setError("Не удалось открыть оплату. Попробуйте ещё раз через минуту.");
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Не удалось оформить заказ. Проверьте данные и попробуйте снова.");
        setLoading(false);
        return;
      }

      // Онлайн-оплата: страница с таймером 10 минут. Корзину очистит она — после подтверждения банком.
      if (data.payPage) {
        router.push(data.payPage);
        return;
      }

      if (data.paymentUrl) {
        // Корзина очищается на странице успеха только после подтверждения оплаты.
        window.location.href = data.paymentUrl;
      } else {
        clear();
        router.push(`/checkout/success?order=${data.orderNumber}`);
      }
    } catch {
      setError("Ошибка сети. Попробуйте ещё раз.");
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-8 md:grid-cols-[1.5fr_1fr]">
      <form onSubmit={handleSubmit} className="card flex flex-col gap-4 p-6">
        <h1 className="text-xl font-semibold text-brand-800">Оформление заказа</h1>

        <input
          required
          placeholder="Имя и фамилия"
          className="input"
          value={form.customerName}
          onChange={(e) => setForm({ ...form, customerName: e.target.value })}
        />
        <input
          required
          type="email"
          placeholder="Email"
          className="input"
          value={form.customerEmail}
          onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
        />
        <input
          required
          placeholder="Телефон"
          className="input"
          value={form.customerPhone}
          onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
        />
        {ozonEnabled ? (
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium text-brand-800">Доставка</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="delivery-mode" checked={mode === "OZON_PVZ"} onChange={() => setMode("OZON_PVZ")} />
              Ozon — пункт выдачи
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="delivery-mode" checked={mode === "MANUAL"} onChange={() => setMode("MANUAL")} />
              Согласовать доставку с менеджером
            </label>
          </fieldset>
        ) : null}

        {useOzon ? (
          <>
            <OzonDelivery
              items={items.map((i) => ({ productId: i.productId, quantity: i.quantity }))}
              onChange={setOzon}
            />
            <div className="grid gap-2 sm:grid-cols-3">
              <input required placeholder="Фамилия получателя" className="input" value={recipient.lastName} onChange={(e) => setRecipient({ ...recipient, lastName: e.target.value })} />
              <input required placeholder="Имя получателя" className="input" value={recipient.firstName} onChange={(e) => setRecipient({ ...recipient, firstName: e.target.value })} />
              <input placeholder="Отчество (необязательно)" className="input" value={recipient.middleName} onChange={(e) => setRecipient({ ...recipient, middleName: e.target.value })} />
            </div>
          </>
        ) : (
          <>
            <input
              required
              placeholder="Город"
              className="input"
              value={form.deliveryCity}
              onChange={(e) => setForm({ ...form, deliveryCity: e.target.value })}
            />
            <input
              required
              placeholder="Адрес доставки"
              className="input"
              value={form.deliveryAddress}
              onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })}
            />
          </>
        )}
        <textarea
          placeholder="Комментарий к заказу (необязательно)"
          className="input"
          rows={3}
          value={form.comment}
          onChange={(e) => setForm({ ...form, comment: e.target.value })}
        />

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={offer} onChange={(e) => setOffer(e.target.checked)} className="mt-1" />
          <span>
            Я ознакомился(-ась) с <Link href="/offer" target="_blank" className="underline">публичной офертой</Link> и{" "}
            <Link href="/returns" target="_blank" className="underline">условиями доставки и возврата</Link>
          </span>
        </label>
        <p className="text-xs text-brand-500">
          Данные для заказа обрабатываются по{" "}
          <Link href="/privacy" target="_blank" className="underline">Политике обработки персональных данных</Link>.
          Дополнительные согласия ниже необязательны и не влияют на оформление заказа.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={pdn} onChange={(e) => setPdn(e.target.checked)} className="mt-1" />
          <span>Даю согласие на обработку персональных данных, как описано в Политике (необязательно)</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={ads} onChange={(e) => setAds(e.target.checked)} className="mt-1" />
          <span>Согласен(-на) получать рекламные предложения VIA LABOTE по e-mail. Отписаться можно в любой момент; не является условием покупки.</span>
        </label>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button type="submit" className="btn-primary" disabled={loading || !offer || (useOzon && !ozon)}>
          {loading ? "Оформляем..." : "Оплатить онлайн"}
        </button>
      </form>

      <div className="card h-fit p-6">
        <h2 className="mb-4 font-semibold text-brand-800">Ваш заказ</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {items.map((i) => (
            <li key={i.productId} className="flex justify-between">
              <span>
                {i.title} × {i.quantity}
              </span>
              <span>{formatPrice(i.price * i.quantity)}</span>
            </li>
          ))}
        </ul>
        {useOzon && ozon ? (
          <div className="mt-2 flex justify-between text-sm text-brand-600">
            <span>Доставка Ozon, до {formatDeliveryDate(ozon.quote.maxDate)}</span>
            <span>{formatPrice(deliveryPrice)}</span>
          </div>
        ) : null}
        <div className="mt-4 flex justify-between border-t border-brand-100 pt-4 font-semibold text-brand-800">
          <span>Итого</span>
          <span>{formatPrice(totalAmount + deliveryPrice)}</span>
        </div>
      </div>
    </div>
  );
}
