import { LegalDocument } from "@/lib/legal-render";
import { PRIVACY_MD } from "@/content/legal/privacy";

export const metadata = { title: "Политика обработки персональных данных — Vialabote" };

export default function Page() {
  return <LegalDocument title="Политика обработки персональных данных VIA LABOTE" source={PRIVACY_MD} />;
}
