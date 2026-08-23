import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage() {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    include: { items: true },
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-brand-800">Заказы</h1>

      <div className="flex flex-col gap-4">
        {orders.map((order) => (
          <div key={order.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-brand-800">Заказ {order.number}</span>
              <span className="text-sm text-brand-500">{order.status}</span>
            </div>
            <p className="text-sm text-brand-600">
              {order.customerName} · {order.customerPhone} · {order.customerEmail}
            </p>
            <p className="text-sm text-brand-600">
              {order.deliveryCity}, {order.deliveryAddress}
            </p>
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
        {orders.length === 0 ? <p className="text-brand-500">Заказов пока нет.</p> : null}
      </div>
    </div>
  );
}
