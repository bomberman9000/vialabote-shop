"use client";

import { useState } from "react";

interface ContentFields {
  title: string;
  subtitle: string;
  description: string;
  activeIngredients: string;
  howToUse: string;
  volume: string;
  badge: string;
}

export function ProductContentForm({
  productId,
  version,
  initial,
}: {
  productId: string;
  version: number;
  initial: ContentFields;
}) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/products/${productId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", expectedVersion: version, ...form }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.message ?? "Не удалось сохранить");
      return;
    }
    window.location.reload();
  }

  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
      <input
        placeholder="Название"
        className="input"
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
      />
      <input
        placeholder="Подзаголовок"
        className="input"
        value={form.subtitle}
        onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
      />
      <input
        placeholder="Объём (напр. 50 мл)"
        className="input"
        value={form.volume}
        onChange={(e) => setForm({ ...form, volume: e.target.value })}
      />
      <input
        placeholder="Бейдж (напр. Хит продаж)"
        className="input"
        value={form.badge}
        onChange={(e) => setForm({ ...form, badge: e.target.value })}
      />
      <textarea
        placeholder="Описание"
        className="input md:col-span-2"
        rows={3}
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
      />
      <textarea
        placeholder={"Активные компоненты, по строке: Название — описание"}
        className="input md:col-span-2"
        rows={3}
        value={form.activeIngredients}
        onChange={(e) => setForm({ ...form, activeIngredients: e.target.value })}
      />
      <textarea
        placeholder={"Как использовать, по строке"}
        className="input md:col-span-2"
        rows={3}
        value={form.howToUse}
        onChange={(e) => setForm({ ...form, howToUse: e.target.value })}
      />
      {error ? <p className="text-sm text-red-600 md:col-span-2">{error}</p> : null}
      <button className="btn-outline w-fit md:col-span-2" disabled={busy}>
        Сохранить контент
      </button>
    </form>
  );
}
