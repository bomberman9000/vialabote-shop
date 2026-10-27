import { LEGAL_VERSION, SELLER, DELIVERY_TERMS, RETURN_TERMS } from "@/lib/legal";

export function SellerBlock() {
  return (
    <ul className="list-disc pl-5">
      <li>Продавец: {SELLER.name}</li>
      <li>ИНН/КПП: {SELLER.inn}/{SELLER.kpp}, ОГРН: {SELLER.ogrn}</li>
      <li>Юридический адрес: {SELLER.legalAddress}</li>
      <li>Фактический адрес: {SELLER.address}</li>
      <li>Руководитель: директор {SELLER.director}</li>
      <li>Email: {SELLER.email}, телефон: {SELLER.phone}</li>
      <li>
        Банковские реквизиты: р/с {SELLER.account} в {SELLER.bank}, к/с {SELLER.corrAccount}, БИК {SELLER.bik}
      </li>
    </ul>
  );
}

export function LegalShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="card mx-auto max-w-3xl space-y-4 p-6 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold text-brand-800">{title}</h1>
      <p className="text-xs text-brand-500">Редакция от {LEGAL_VERSION}.</p>
      {children}
    </article>
  );
}

export { DELIVERY_TERMS, RETURN_TERMS };
