"use client";

import { useState } from "react";

interface DiscountData {
  type: string;
  value: number;
  startsAt: string | null;
  endsAt: string | null;
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export function ProductDiscountForm({
  productId,
  version,
  discount,
}: {
  productId: string;
  version: number;
  discount: DiscountData | null;
}) {
  const [type, setType] = useState<"percent" | "fixed">((discount?.type as "percent" | "fixed") ?? "percent");
  const [value, setValue] = useState(discount ? String(discount.value) : "");
  const [endsAt, setEndsAt] = useState(toDateInputValue(discount?.endsAt ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/products/${productId}/discount`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedVersion: version,
        type,
        value: type === "percent" ? Number(value) : Math.round(Number(value) * 100),
        startsAt: null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.message ?? "Не удалось сохранить скидку");
      return;
    }
    window.location.reload();
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/products/${productId}/discount`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: version }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.message ?? "Не удалось убрать скидку");
      return;
    }
    window.location.reload();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label className="text-xs uppercase tracking-wide text-brand-500">Скидка</label>
      <div className="flex flex-wrap gap-2">
        <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value as "percent" | "fixed")}>
          <option value="percent">%</option>
          <option value="fixed">₽ (фикс.)</option>
        </select>
        <input
          type="number"
          min={0}
          step={type === "percent" ? "1" : "0.01"}
          placeholder={type === "percent" ? "напр. 15" : "напр. 500"}
          className="input w-28"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <input
          type="date"
          className="input w-auto"
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
          title="Дата окончания (пусто = бессрочно)"
        />
      </div>
      <div className="flex gap-2">
        <button className="btn-outline" disabled={busy || !value}>
          {discount ? "Обновить" : "Установить"}
        </button>
        {discount ? (
          <button type="button" className="text-sm text-red-600 hover:underline" disabled={busy} onClick={remove}>
            Убрать скидку
          </button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}
