import { LegalDocument } from "@/lib/legal-render";
import { OFFER_MD } from "@/content/legal/offer";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata(
  "/offer",
  "Публичная оферта — Vialabote",
  "Публичная оферта интернет-магазина VIA LABOTE: условия продажи косметики, цены, порядок оплаты и доставки, права покупателя и порядок возврата.",
);

export default function Page() {
  return <LegalDocument title="Публичная оферта интернет-магазина VIA LABOTE" source={OFFER_MD} />;
}
