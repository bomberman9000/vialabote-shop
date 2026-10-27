import { LEGAL_VERSION, SELLER, DELIVERY_REGIONS, DELIVERY_SERVICES } from "@/lib/legal";

// Подставляем ТОЛЬКО то, что подтверждено карточкой организации и словами владельца.
// Всё остальное ([EMAIL ДЛЯ ПРЕТЕНЗИЙ], [ПОЧТОВЫЙ АДРЕС], способы оплаты, @username бота,
// тарифы и сроки) остаётся видимым [..]: выдумывать эти данные нельзя.
const SELLER_NAME_FIELDS = [
  "[ПОЛНОЕ НАИМЕНОВАНИЕ ООО / ФИО ИП]",
  "[ПОЛНОЕ НАИМЕНОВАНИЕ/ФИО ИП]",
  "[ПОЛНОЕ НАЗВАНИЕ / ФИО ИП]",
  "[ПОЛНОЕ НАИМЕНОВАНИЕ]",
];

export function fillPlaceholders(text: string): string {
  let t = text;
  for (const f of SELLER_NAME_FIELDS) t = t.split(f).join(SELLER.name);
  const rules: [RegExp | string, string][] = [
    ["ОГРН/ОГРНИП [___]", `ОГРН ${SELLER.ogrn}`],
    ["ИНН [___]", `ИНН ${SELLER.inn}, КПП ${SELLER.kpp}`],
    ["адрес [___], e-mail [___], телефон [___]", `адрес ${SELLER.legalAddress}, e-mail ${SELLER.email}, телефон ${SELLER.phone}`],
    ["[ОГРН/ОГРНИП]; [ИНН]; [ЮРИДИЧЕСКИЙ И ПОЧТОВЫЙ АДРЕС]; [E-MAIL]; [ТЕЛЕФОН]", `ОГРН ${SELLER.ogrn}; ИНН ${SELLER.inn}; КПП ${SELLER.kpp}; ${SELLER.legalAddress}; ${SELLER.email}; ${SELLER.phone}`],
    ["[ОГРН/ОГРНИП], [АДРЕС], [EMAIL], [ТЕЛЕФОН]", `ОГРН ${SELLER.ogrn}, ${SELLER.legalAddress}, ${SELLER.email}, ${SELLER.phone}`],
    ["адрес [___], e-mail для запросов о ПДн [___]", `адрес ${SELLER.legalAddress}, e-mail для запросов о ПДн [E-MAIL ДЛЯ ЗАПРОСОВ О ПДн]`],
    ["адрес [___]", `адрес ${SELLER.legalAddress}`],
    ["[РЕГИОНЫ ДОСТАВКИ]", DELIVERY_REGIONS],
    ["[РЕГИОНЫ]", DELIVERY_REGIONS],
    ["[СПИСОК ПОДКЛЮЧЁННЫХ СЛУЖБ]", DELIVERY_SERVICES],
    ["Редакция [ДАТА]", `Редакция от ${LEGAL_VERSION}`],
  ];
  for (const [from, to] of rules) t = t.split(from as string).join(to);
  return t;
}

/** Поля [..], которые ещё не заполнены: пока список не пуст, документ не готов к публикации. */
export function unresolvedPlaceholders(text: string): string[] {
  return [...new Set(text.match(/\[[^\]\n]{2,}\]/g) ?? [])];
}

function Inline({ text }: { text: string }) {
  const urls = /(https?:\/\/[^\s)]+?)(?=[.,;:]?(?:\s|$))/g;
  return (
    <>
      {text.split("**").map((chunk, i) => {
        const parts = chunk.split(urls);
        const node = parts.map((p, j) =>
          j % 2 === 1 ? (
            <a key={j} href={p} className="underline">
              {p}
            </a>
          ) : (
            <span key={j}>{p}</span>
          ),
        );
        return i % 2 === 1 ? <strong key={i}>{node}</strong> : <span key={i}>{node}</span>;
      })}
    </>
  );
}

export function LegalDocument({ title, source }: { title: string; source: string }) {
  const text = fillPlaceholders(source);
  const missing = unresolvedPlaceholders(text);
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);

  return (
    <article className="card mx-auto max-w-3xl space-y-4 p-6 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold text-brand-800">{title}</h1>
      <p className="text-xs text-brand-500">Редакция от {LEGAL_VERSION}.</p>
      {missing.length > 0 ? (
        <p role="note" className="rounded-lg border border-gold-400 bg-gold-50 p-3 text-xs text-brand-800">
          Документ не готов к публикации: не заполнены поля {missing.join(", ")}.
        </p>
      ) : null}
      {blocks.map((b, i) =>
        b.startsWith("## ") ? (
          <h2 key={i} className="pt-2 text-lg font-semibold">
            {b.slice(3)}
          </h2>
        ) : (
          <p key={i}>
            <Inline text={b} />
          </p>
        ),
      )}
    </article>
  );
}
