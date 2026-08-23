"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProductLifecycleActions({
  productId,
  status,
  version,
}: {
  productId: string;
  status: string;
  version: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function transition(action: "publish" | "archive") {
    setBusy(true);
    const res = await fetch(`/api/admin/products/${productId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, expectedVersion: version }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.message ?? "Не удалось изменить статус");
      return;
    }
    // Полная перезагрузка, а не router.refresh(): на этой странице несколько
    // независимых форм читают один и тот же product.version, и soft-refresh
    // не всегда доносит обновлённые server props до всех них синхронно —
    // hard reload гарантирует консистентное состояние перед следующей мутацией.
    window.location.reload();
  }

  async function remove() {
    if (!confirm("Удалить товар безвозвратно?")) return;
    setBusy(true);
    const res = await fetch(`/api/admin/products/${productId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: version }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.message ?? "Не удалось удалить товар");
      return;
    }
    router.push("/admin/products");
  }

  return (
    <div className="flex gap-2">
      {status !== "published" ? (
        <button className="btn-outline" disabled={busy} onClick={() => transition("publish")}>
          Опубликовать
        </button>
      ) : (
        <button className="btn-outline" disabled={busy} onClick={() => transition("archive")}>
          Скрыть
        </button>
      )}
      <button className="text-sm text-red-600 hover:underline" disabled={busy} onClick={remove}>
        Удалить
      </button>
    </div>
  );
}
