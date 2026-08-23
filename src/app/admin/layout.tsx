import Link from "next/link";
import { requireAdmin } from "@/lib/admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();

  return (
    <div className="flex flex-col gap-6">
      <nav className="flex gap-4 border-b border-brand-100 pb-4 text-sm font-medium text-brand-700">
        <Link href="/admin/products">Товары</Link>
        <Link href="/admin/orders">Заказы</Link>
      </nav>
      {children}
    </div>
  );
}
