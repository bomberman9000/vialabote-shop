import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/money";

const STATUS_LABELS: Record<string, string> = {
  NEW: "Новый",
  AWAITING_PAYMENT: "Ожидает оплаты",
  PAID: "Оплачен",
  PROCESSING: "В обработке",
  SHIPPED: "Отправлен",
  COMPLETED: "Завершён",
  CANCELLED: "Отменён",
};

export default async function AccountPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/account/login");

  const userId = (session.user as { id: string }).id;
  const orders = await prisma.order.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { items: true },
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-brand-800">Личный кабинет</h1>
      <p className="text-brand-600">
        {session.user.name || session.user.email}
        {(session.user as { role?: string }).role === "ADMIN" ? (
          <>
            {" "}
            ·{" "}
            <Link href="/admin/products" className="text-brand-700 hover:underline">
              Админ-панель
            </Link>
          </>
        ) : null}
      </p>

      <div>
        <h2 className="mb-4 text-lg font-semibold text-brand-800">Мои заказы</h2>
        {orders.length === 0 ? (
          <p className="text-brand-500">Заказов пока нет.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {orders.map((order) => (
              <div key={order.id} className="card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-brand-800">Заказ {order.number}</span>
                  <span className="text-sm text-brand-500">
                    {STATUS_LABELS[order.status] ?? order.status}
                  </span>
                </div>
                <ul className="mt-2 text-sm text-brand-600">
                  {order.items.map((item) => (
                    <li key={item.id}>
                      {item.title} × {item.quantity}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 font-medium text-brand-800">{formatPrice(order.totalAmount)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
