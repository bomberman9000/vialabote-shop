"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

export function NewProductForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    priceRub: "",
    imageUrl: "",
    stock: "10",
    categoryName: "Уход за лицом",
    description: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        slug: slugify(form.title) + "-" + Date.now().toString(36),
        description: form.description,
        price: Math.round(Number(form.priceRub) * 100),
        imageUrl: form.imageUrl || "/images/placeholder.svg",
        stock: Number(form.stock),
        categorySlug: slugify(form.categoryName),
        categoryName: form.categoryName,
        isActive: true,
      }),
    });

    setLoading(false);

    if (!res.ok) {
      setError("Не удалось добавить товар");
      return;
    }

    setForm({ ...form, title: "", priceRub: "", imageUrl: "", description: "" });
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="card grid gap-3 p-6 md:grid-cols-2">
      <h2 className="col-span-full font-semibold text-brand-800">Добавить товар</h2>
      <input
        required
        placeholder="Название"
        className="input"
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
      />
      <input
        required
        placeholder="Категория"
        className="input"
        value={form.categoryName}
        onChange={(e) => setForm({ ...form, categoryName: e.target.value })}
      />
      <input
        required
        type="number"
        min={0}
        step="0.01"
        placeholder="Цена, ₽"
        className="input"
        value={form.priceRub}
        onChange={(e) => setForm({ ...form, priceRub: e.target.value })}
      />
      <input
        type="number"
        min={0}
        placeholder="Остаток"
        className="input"
        value={form.stock}
        onChange={(e) => setForm({ ...form, stock: e.target.value })}
      />
      <input
        placeholder="URL картинки (/images/products/... после загрузки в репозиторий)"
        className="input md:col-span-2"
        value={form.imageUrl}
        onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
      />
      <textarea
        placeholder="Описание"
        className="input md:col-span-2"
        rows={3}
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
      />
      {error ? <p className="text-sm text-red-600 md:col-span-2">{error}</p> : null}
      <button className="btn-primary w-fit md:col-span-2" disabled={loading}>
        {loading ? "Добавляем..." : "Добавить"}
      </button>
    </form>
  );
}
