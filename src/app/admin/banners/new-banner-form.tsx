"use client";

import { useState } from "react";

// Порядок жёстко зафиксирован: файл сначала проходит contract validation +
// storage через /api/admin/media (attachMedia), и только ПОТОМ, с уже
// валидным mediaId, создаётся сам баннер — banner никогда не может
// сослаться на непровалидированное медиа (createBanner это и так
// перепроверяет через assertMediaValid, но и здесь порядок шагов такой же).
export function NewBannerForm() {
  const [name, setName] = useState("");
  const [placement, setPlacement] = useState("HOME_HERO");
  const [headline, setHeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[] | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;

    setBusy(true);
    setError(null);
    setReasons(null);

    const uploadData = new FormData();
    uploadData.set("file", file);
    uploadData.set("purpose", "HERO_DESKTOP");

    const uploadRes = await fetch("/api/admin/media", { method: "POST", body: uploadData });
    if (!uploadRes.ok) {
      const body = await uploadRes.json().catch(() => ({}));
      setBusy(false);
      setError(body.message ?? "Не удалось загрузить изображение");
      if (body.details?.reasons) setReasons(body.details.reasons);
      return;
    }
    const media = await uploadRes.json();

    const createRes = await fetch("/api/admin/banners", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, placement, desktopMediaId: media.id, headline: headline || undefined }),
    });
    setBusy(false);

    if (!createRes.ok) {
      const body = await createRes.json().catch(() => ({}));
      setError(body.message ?? "Не удалось создать баннер");
      return;
    }

    // Hard reload — см. коммент в admin/products/[id]/product-lifecycle-actions.tsx:
    // router.refresh() ненадёжно доносит новый элемент списка до соседних
    // client-компонентов на этой странице (list + отдельная форма создания).
    window.location.reload();
  }

  return (
    <form onSubmit={submit} className="card grid gap-3 p-6 md:grid-cols-2">
      <h2 className="col-span-full font-semibold text-brand-800">Новый баннер</h2>
      <input
        required
        placeholder="Название (для админки)"
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        required
        placeholder="Placement (напр. HOME_HERO)"
        className="input"
        value={placement}
        onChange={(e) => setPlacement(e.target.value)}
      />
      <input
        placeholder="Заголовок (опционально)"
        className="input md:col-span-2"
        value={headline}
        onChange={(e) => setHeadline(e.target.value)}
      />
      <div className="flex flex-col gap-1 md:col-span-2">
        <label className="text-xs uppercase tracking-wide text-brand-500">Изображение (desktop, 16:9)</label>
        <input type="file" name="file" accept="image/jpeg,image/png,image/webp" className="input" required />
      </div>
      {error ? (
        <div className="text-sm text-red-600 md:col-span-2">
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
      <button className="btn-primary w-fit md:col-span-2" disabled={busy}>
        {busy ? "Создаём..." : "Создать (черновик)"}
      </button>
    </form>
  );
}
