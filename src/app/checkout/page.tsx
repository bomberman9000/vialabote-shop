"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart-context";
import { formatPrice } from "@/lib/money";

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
          offerAccepted: offer,
          pdnConsent: pdn,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError("Не удалось оформить заказ. Проверьте данные и попробуйте снова.");
        setLoading(false);
        return;
      }

      if (data.paymentError) {
        // Заказ создан, но платёж не открылся — корзину не трогаем.
        setError("Не удалось открыть оплату. Заказ сохранён, попробуйте ещё раз или свяжитесь с нами.");
        setLoading(false);
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
        <textarea
          placeholder="Комментарий к заказу (необязательно)"
          className="input"
          rows={3}
          value={form.comment}
          onChange={(e) => setForm({ ...form, comment: e.target.value })}
        />

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={offer} onChange={(e) => setOffer(e.target.checked)} className="mt-1" />
          <span>Я принимаю условия <Link href="/offer" target="_blank" className="underline">публичной оферты</Link></span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={pdn} onChange={(e) => setPdn(e.target.checked)} className="mt-1" />
          <span>Я даю согласие на обработку персональных данных в соответствии с <Link href="/privacy" target="_blank" className="underline">Политикой</Link></span>
        </label>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button type="submit" className="btn-primary" disabled={loading || !offer || !pdn}>
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
        <div className="mt-4 flex justify-between border-t border-brand-100 pt-4 font-semibold text-brand-800">
          <span>Итого</span>
          <span>{formatPrice(totalAmount)}</span>
        </div>
      </div>
    </div>
  );
}
