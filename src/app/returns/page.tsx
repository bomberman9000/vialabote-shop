import { LegalDocument } from "@/lib/legal-render";
import { RETURNS_MD } from "@/content/legal/returns";

export const metadata = { title: "Доставка, оплата и возврат — Vialabote" };

export default function Page() {
  return <LegalDocument title="Доставка, оплата и возврат" source={RETURNS_MD} />;
}
