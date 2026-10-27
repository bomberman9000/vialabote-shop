import { LEGAL_VERSION, SELLER, DELIVERY_TERMS, RETURN_TERMS } from "@/lib/legal";

export function SellerBlock() {
  return (
    <ul className="list-disc pl-5">
      <li>Продавец: {SELLER.name}</li>
      <li>ИНН: {SELLER.inn}</li>
      <li>ОГРН/ОГРНИП: {SELLER.ogrn}</li>
      <li>Адрес: {SELLER.address}</li>
      <li>Email: {SELLER.email}</li>
      <li>Телефон: {SELLER.phone}</li>
    </ul>
  );
}

export function LegalShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="card mx-auto max-w-3xl space-y-4 p-6 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold text-brand-800">{title}</h1>
      <p className="text-xs text-brand-500">Версия от {LEGAL_VERSION}. Черновик — требует проверки юристом.</p>
      {children}
    </article>
  );
}

export { DELIVERY_TERMS, RETURN_TERMS };
