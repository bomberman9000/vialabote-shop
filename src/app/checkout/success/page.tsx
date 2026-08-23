import Link from "next/link";

export default function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: { order?: string };
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <h1 className="text-2xl font-semibold text-brand-800">Спасибо за заказ!</h1>
      {searchParams.order ? (
        <p className="text-brand-600">Номер заказа: {searchParams.order}</p>
      ) : null}
      <p className="max-w-md text-brand-600">
        Мы получили ваш заказ и свяжемся с вами для подтверждения деталей доставки.
      </p>
      <Link href="/catalog" className="btn-primary">
        Продолжить покупки
      </Link>
    </div>
  );
}
