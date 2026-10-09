"use client";

import { useState } from "react";
import Image from "next/image";

interface MediaItem {
  id: string;
  url: string;
  purpose: string;
  isPrimary: boolean;
  width: number;
  height: number;
}

const PURPOSES = [
  { value: "PRODUCT_PRIMARY", label: "Основное фото (1:1)" },
  { value: "PRODUCT_GALLERY", label: "Доп. фото галереи (1:1)" },
];

export function ProductMediaManager({ productId, media }: { productId: string; media: MediaItem[] }) {
  const [purpose, setPurpose] = useState(PURPOSES[0].value);
  const [isPrimary, setIsPrimary] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[] | null>(null);

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;

    setBusy(true);
    setError(null);
    setReasons(null);

    const formData = new FormData();
    formData.set("file", file);
    formData.set("purpose", purpose);
    formData.set("isPrimary", String(isPrimary));

    const res = await fetch(`/api/admin/products/${productId}/media`, { method: "POST", body: formData });
    setBusy(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.message ?? "Не удалось загрузить изображение");
      if (body.details?.reasons) setReasons(body.details.reasons);
      return;
    }
    form.reset();
    window.location.reload();
  }

  async function setPrimary(mediaId: string) {
    setBusy(true);
    const res = await fetch(`/api/admin/media/${mediaId}`, { method: "PATCH" });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.message ?? "Не удалось сделать основным");
      return;
    }
    window.location.reload();
  }

  async function remove(mediaId: string) {
    if (!confirm("Удалить изображение?")) return;
    setBusy(true);
    const res = await fetch(`/api/admin/media/${mediaId}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.message ?? "Не удалось удалить изображение");
      return;
    }
    window.location.reload();
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={upload} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs uppercase tracking-wide text-brand-500">Тип</label>
          <select className="input w-auto" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            {PURPOSES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-brand-600">
          <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
          Сделать основным
        </label>
        <input type="file" name="file" accept="image/jpeg,image/png,image/webp" className="input w-auto" required />
        <button className="btn-outline" disabled={busy}>
          Загрузить
        </button>
      </form>
      {error ? (
        <div className="text-sm text-red-600">
          <p>{error}</p>
          {reasons ? (
            <ul className="ml-4 list-disc">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {media.length === 0 ? (
        <p className="text-sm text-brand-500">Изображений пока нет — товар показывает placeholder.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {media.map((m) => (
            <div key={m.id} className="flex flex-col gap-2 rounded-xl border border-brand-100 p-2">
              <div className="relative aspect-square overflow-hidden rounded-lg bg-brand-50">
                <Image src={m.url} alt="" fill className="object-contain" sizes="200px" />
                {m.isPrimary ? (
                  <span className="absolute left-1 top-1 rounded-full bg-gold-400 px-2 py-0.5 text-[10px] font-medium text-brand-900">
                    Основное
                  </span>
                ) : null}
              </div>
              <p className="text-[11px] text-brand-500">
                {m.purpose} · {m.width}×{m.height}
              </p>
              <div className="flex justify-between text-xs">
                {!m.isPrimary ? (
                  <button className="text-brand-600 hover:underline" disabled={busy} onClick={() => setPrimary(m.id)}>
                    Сделать основным
                  </button>
                ) : (
                  <span />
                )}
                <button className="text-red-600 hover:underline" disabled={busy} onClick={() => remove(m.id)}>
                  Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
