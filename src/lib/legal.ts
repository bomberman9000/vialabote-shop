// Версия юридических документов. При любом изменении текста оферты/политики
// увеличивайте версию: она сохраняется вместе с заказом как факт согласия.
export const LEGAL_VERSION = "2026-10-27";

const TODO = (what: string) => `[УКАЗАТЬ: ${what}]`;

// Реквизиты продавца берутся из переменных окружения. Пока они не заданы,
// на сайте видны явные заглушки — выдумывать реквизиты нельзя.
export const SELLER = {
  name: process.env.NEXT_PUBLIC_SELLER_NAME || TODO("наименование ИП/ООО"),
  inn: process.env.NEXT_PUBLIC_SELLER_INN || TODO("ИНН"),
  ogrn: process.env.NEXT_PUBLIC_SELLER_OGRN || TODO("ОГРН/ОГРНИП"),
  address: process.env.NEXT_PUBLIC_SELLER_ADDRESS || TODO("адрес"),
  email: process.env.NEXT_PUBLIC_SELLER_EMAIL || "hello@vialabote.ru",
  phone: process.env.NEXT_PUBLIC_SELLER_PHONE || TODO("телефон"),
};

export const DELIVERY_TERMS =
  process.env.NEXT_PUBLIC_DELIVERY_TERMS || TODO("условия и сроки доставки");
export const RETURN_TERMS =
  process.env.NEXT_PUBLIC_RETURN_TERMS || TODO("условия возврата");
