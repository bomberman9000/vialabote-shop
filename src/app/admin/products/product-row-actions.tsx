"use client";

import { useRouter } from "next/navigation";

export function ProductRowActions({
  productId,
  isActive,
}: {
  productId: string;
  isActive: boolean;
}) {
  const router = useRouter();

  async function toggleActive() {
    await fetch(`/api/admin/products/${productId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    router.refresh();
  }

  async function remove() {
    if (!confirm("Удалить товар?")) return;
    await fetch(`/api/admin/products/${productId}`, { method: "DELETE" });
    router.refresh();
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
