export function Footer() {
  return (
    <footer id="delivery" className="bg-brand-900 py-12 text-sm text-brand-200">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 md:grid-cols-3">
        <div>
          <h3 className="mb-2 font-display text-lg text-gold-300">VIA LABOTE</h3>
          <p>Лаборатория персональной косметики. Наука. Природа. Гармония.</p>
        </div>
        <div>
          <h3 className="mb-2 font-semibold text-brand-50">Доставка и оплата</h3>
          <p>Доставка по России курьером и в пункты выдачи. Онлайн-оплата картой через ЮKassa.</p>
        </div>
        <div>
          <h3 className="mb-2 font-semibold text-brand-50">Контакты</h3>
          <p>Email: hello@vialabote.ru</p>
        </div>
      </div>
      <p className="mt-8 text-center text-xs text-brand-400">
        © {new Date().getFullYear()} Via Labote. Все права защищены.
      </p>
    </footer>
  );
}
