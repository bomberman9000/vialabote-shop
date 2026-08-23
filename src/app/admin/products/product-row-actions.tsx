"use client";

export function ProductRowActions({
  productId,
  isActive,
  version,
}: {
  productId: string;
  isActive: boolean;
  version: number;
}) {
  async function toggleActive() {
    const res = await fetch(`/api/admin/products/${productId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: isActive ? "archive" : "publish", expectedVersion: version }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.message ?? "Не удалось изменить статус товара");
      return;
    }
    // Hard reload, не router.refresh() — надёжно на страницах с несколькими
    // независимо мутирующими client-компонентами (см. коммент в
    // admin/products/[id]/product-lifecycle-actions.tsx).
    window.location.reload();
  }

  async function remove() {
    if (!confirm("Удалить товар?")) return;
    const res = await fetch(`/api/admin/products/${productId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: version }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.message ?? "Не удалось удалить товар");
      return;
    }
    window.location.reload();
  }

  return (
    <div className="flex gap-3">
      <button onClick={toggleActive} className="text-brand-600 hover:underline">
        {isActive ? "Скрыть" : "Показать"}
      </button>
      <button onClick={remove} className="text-red-500 hover:underline">
        Удалить
      </button>
    </div>
  );
}
