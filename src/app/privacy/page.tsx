import { LegalDocument } from "@/lib/legal-render";
import { PRIVACY_MD } from "@/content/legal/privacy";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata(
  "/privacy",
  "Политика обработки персональных данных — Vialabote",
  "Политика обработки персональных данных покупателей интернет-магазина VIA LABOTE: какие данные собираем, зачем, как долго храним и как их защищаем.",
);

export default function Page() {
  return <LegalDocument title="Политика обработки персональных данных VIA LABOTE" source={PRIVACY_MD} />;
}
