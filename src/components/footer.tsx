export function Footer() {
  return (
    <footer id="delivery" className="border-t border-brand-100 bg-white py-10 text-sm text-brand-700">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 md:grid-cols-3">
        <div>
          <h3 className="mb-2 font-semibold text-brand-800">Vialabote</h3>
          <p>Собственный интернет-магазин косметики и ухода.</p>
        </div>
        <div>
          <h3 className="mb-2 font-semibold text-brand-800">Доставка и оплата</h3>
          <p>Доставка по России курьером и в пункты выдачи. Онлайн-оплата картой через ЮKassa.</p>
        </div>
        <div>
          <h3 className="mb-2 font-semibold text-brand-800">Контакты</h3>
          <p>Email: hello@vialabote.ru</p>
        </div>
      </div>
      <p className="mt-8 text-center text-xs text-brand-400">
        © {new Date().getFullYear()} Vialabote. Все права защищены.
      </p>
    </footer>
  );
}
