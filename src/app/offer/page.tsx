import { LegalDocument } from "@/lib/legal-render";
import { OFFER_MD } from "@/content/legal/offer";

export const metadata = { title: "Публичная оферта — Vialabote" };

export default function Page() {
  return <LegalDocument title="Публичная оферта интернет-магазина VIA LABOTE" source={OFFER_MD} />;
}
