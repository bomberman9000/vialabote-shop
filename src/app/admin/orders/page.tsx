import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/money";
import { formatDeliveryDate } from "@/lib/delivery/format";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage() {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    include: { items: true, ozon: true },
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
            {order.ozon ? (
              <div className="mt-2 rounded border border-brand-100 p-2 text-sm text-brand-600">
                <p>
                  Ozon ({order.ozon.deliveryType === "PVZ" ? "пункт выдачи" : "курьер"}): <b>{order.ozon.state}</b>
                  {order.ozon.status ? ` · ${order.ozon.status}` : ""}
                  {order.ozon.ozonOrderNumber ? ` · заказ ${order.ozon.ozonOrderNumber}` : ""}
                  {order.ozon.postingNumbers.length ? ` · отправления ${order.ozon.postingNumbers.join(", ")}` : ""}
                </p>
                <p>
                  Доставка {formatPrice(order.deliveryPrice ?? 0)}, срок до {formatDeliveryDate(order.deliveryMaxDate) ?? "—"}
                </p>
                {order.ozon.state === "FAILED" ? <p className="text-red-600">Доставка не создана — нужен ручной разбор</p> : null}
                {order.ozon.state === "UNKNOWN" ? (
                  <p className="text-red-600">Неизвестно, создан ли заказ в Ozon — сверьте в кабинете Ozon перед повтором</p>
                ) : null}
                {order.ozon.refundState === "REQUIRED" ? <p className="text-red-600">Нужен возврат денег покупателю (вручную)</p> : null}
                {order.ozon.lastError ? <p className="text-xs text-brand-500">{order.ozon.lastError}</p> : null}
              </div>
            ) : null}
            <p className="mt-2 font-medium text-brand-800">{formatPrice(order.totalAmount)}</p>
          </div>
        ))}
        {orders.length === 0 ? <p className="text-brand-500">Заказов пока нет.</p> : null}
      </div>
    </div>
  );
}
