import { LegalDocument } from "@/lib/legal-render";
import { RETURNS_MD } from "@/content/legal/returns";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata(
  "/returns",
  "Доставка, оплата и возврат — Vialabote",
  "Условия доставки, оплаты и возврата заказа в интернет-магазине VIA LABOTE: сроки доставки, способы оплаты, причины отказа от заказа и порядок возврата средств.",
);

export default function Page() {
  return <LegalDocument title="Доставка, оплата и возврат" source={RETURNS_MD} />;
}
