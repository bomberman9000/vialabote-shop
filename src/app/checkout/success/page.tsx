import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ClearCart } from "@/components/clear-cart";

export const dynamic = "force-dynamic";

// Страница возврата из ЮKassa НЕ доказывает оплату: статус берём из БД,
// куда он попадает только после проверки платежа запросом к ЮKassa.
export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: { order?: string };
}) {
  const number = searchParams.order;
  const order = number
    ? await prisma.order.findUnique({ where: { number }, select: { status: true } })
    : null;
  const paid = order?.status === "PAID";
  const accepted = order?.status === "NEW"; // заказ без онлайн-оплаты
  const cancelled = order?.status === "CANCELLED";

  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      {paid || accepted ? <ClearCart /> : null}
      <h1 className="text-2xl font-semibold text-brand-800">
        {paid ? "Заказ оплачен" : accepted ? "Заказ принят" : cancelled ? "Оплата не прошла" : "Ожидаем подтверждение оплаты"}
      </h1>
      {number ? <p className="text-brand-600">Номер заказа: {number}</p> : null}
      <p className="max-w-md text-brand-600">
        {paid || accepted
          ? "Мы свяжемся с вами для подтверждения деталей доставки."
          : cancelled
            ? "Платёж отменён, деньги не списаны. Товары остались в корзине — можно оформить заказ ещё раз."
            : "Банк ещё не подтвердил платёж. Обновите страницу через минуту; корзина сохранена до подтверждения."}
      </p>
      <Link href="/catalog" className="btn-primary">
        Продолжить покупки
      </Link>
    </div>
  );
}
