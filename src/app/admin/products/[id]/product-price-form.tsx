"use client";

import { useState } from "react";

export function ProductPriceForm({
  productId,
  version,
  currentPriceKopecks,
}: {
  productId: string;
  version: number;
  currentPriceKopecks: number;
}) {
  const [priceRub, setPriceRub] = useState(String(currentPriceKopecks / 100));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/products/${productId}/price`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: version, price: Math.round(Number(priceRub) * 100) }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.message ?? "Не удалось изменить цену");
      return;
    }
    // См. комментарий в ProductLifecycleActions — hard reload вместо
    // router.refresh() на этой странице с несколькими независимыми формами.
    window.location.reload();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label className="text-xs uppercase tracking-wide text-brand-500">Базовая цена, ₽</label>
      <div className="flex gap-2">
        <input
          type="number"
          min={0}
          step="0.01"
          className="input"
          value={priceRub}
          onChange={(e) => setPriceRub(e.target.value)}
        />
        <button className="btn-outline" disabled={busy}>
          Сохранить
        </button>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}
