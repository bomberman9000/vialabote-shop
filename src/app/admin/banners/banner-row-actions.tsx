"use client";

import { useState } from "react";

export function BannerRowActions({
  bannerId,
  status,
  version,
  startsAt,
  endsAt,
}: {
  bannerId: string;
  status: string;
  version: number;
  startsAt: string;
  endsAt: string;
}) {
  const [start, setStart] = useState(startsAt);
  const [end, setEnd] = useState(endsAt);
  const [busy, setBusy] = useState(false);

  async function handle(res: Promise<Response>) {
    setBusy(true);
    const r = await res;
    setBusy(false);
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      alert(body.message ?? "Операция не удалась");
      return;
    }
    window.location.reload();
  }

  function schedule() {
    return handle(
      fetch(`/api/admin/banners/${bannerId}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: version,
          startsAt: start ? new Date(start).toISOString() : null,
          endsAt: end ? new Date(end).toISOString() : null,
        }),
      }),
    );
  }

  function publish() {
    return handle(
      fetch(`/api/admin/banners/${bannerId}/publish`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: version }),
      }),
    );
  }

  function archive() {
    return handle(
      fetch(`/api/admin/banners/${bannerId}/archive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: version }),
      }),
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <input type="date" className="input w-auto" value={start} onChange={(e) => setStart(e.target.value)} />
      <input type="date" className="input w-auto" value={end} onChange={(e) => setEnd(e.target.value)} />
      <button className="btn-outline" disabled={busy} onClick={schedule}>
        Запланировать
      </button>
      {status !== "published" ? (
        <button className="btn-outline" disabled={busy} onClick={publish}>
          Опубликовать
        </button>
      ) : null}
      {status !== "archived" ? (
        <button className="text-red-600 hover:underline" disabled={busy} onClick={archive}>
          Архивировать
        </button>
      ) : null}
    </div>
  );
}
