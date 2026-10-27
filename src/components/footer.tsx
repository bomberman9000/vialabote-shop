import Link from "next/link";
import { SELLER } from "@/lib/legal";

export function Footer() {
  return (
    <footer id="delivery" className="bg-brand-900 py-12 text-sm text-brand-200">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 md:grid-cols-4">
        <div>
          <h3 className="mb-2 font-display text-lg text-gold-300">VIA LABOTE</h3>
          <p>Лаборатория персональной косметики. Наука. Природа. Гармония.</p>
        </div>
        <div>
          <h3 className="mb-2 font-semibold text-brand-50">Доставка и оплата</h3>
          <p>Доставка по России. Условия оплаты, доставки и возврата — на странице «<Link href="/returns" className="underline">Доставка и возврат</Link>».</p>
        </div>
        <div>
          <h3 className="mb-2 font-semibold text-brand-50">Контакты</h3>
          <p>Email: {SELLER.email}</p>
          <p>Тел.: {SELLER.phone}</p>
          <p className="mt-2">{SELLER.shortName}</p>
          <p>ИНН/КПП {SELLER.inn}/{SELLER.kpp}, ОГРН {SELLER.ogrn}</p>
          <p>{SELLER.address}</p>
        </div>
        <div>
          <h3 className="mb-2 font-semibold text-brand-50">Документы</h3>
          <p><Link href="/offer" className="underline">Публичная оферта</Link></p>
          <p><Link href="/privacy" className="underline">Политика обработки ПДн</Link></p>
          <p><Link href="/returns" className="underline">Доставка, оплата и возврат</Link></p>
        </div>
      </div>
      <p className="mt-8 text-center text-xs text-brand-400">
        © {new Date().getFullYear()} Via Labote. Все права защищены.
      </p>
    </footer>
  );
}
