import { describe, it, expect } from "vitest";
import { fillPlaceholders, unresolvedPlaceholders } from "./legal-render";
import { SELLER } from "./legal";
import { OFFER_MD } from "@/content/legal/offer";
import { PRIVACY_MD } from "@/content/legal/privacy";
import { RETURNS_MD } from "@/content/legal/returns";

const docs = { offer: OFFER_MD, privacy: PRIVACY_MD, returns: RETURNS_MD };

describe("юридические документы", () => {
  it.each(Object.entries(docs))("%s: служебные пометки черновика не попадают на страницу", (_n, md) => {
    expect(md).not.toMatch(/НЕ ПУБЛИКОВАТЬ|ПРОЕКТ/);
  });

  it.each(Object.entries(docs))("%s: реквизиты продавца из карточки подставлены, имени-заглушки нет", (_n, md) => {
    const t = fillPlaceholders(md);
    expect(t).not.toMatch(/\[ПОЛНОЕ (НАИМЕНОВАНИЕ|НАЗВАНИЕ)/);
    expect(t).not.toContain("[___]");
  });

  it("оферта содержит ИНН, ОГРН и регион доставки", () => {
    const t = fillPlaceholders(OFFER_MD);
    expect(t).toContain(SELLER.inn);
    expect(t).toContain(SELLER.ogrn);
    expect(t).toContain("Российской Федерации");
  });

  it("неизвестное не выдумывается: e-mail для претензий, адрес возврата, способы оплаты остаются заглушками", () => {
    const missing = [
      ...unresolvedPlaceholders(fillPlaceholders(OFFER_MD)),
      ...unresolvedPlaceholders(fillPlaceholders(RETURNS_MD)),
    ].join(" | ");
    expect(missing).toMatch(/EMAIL ДЛЯ ПРЕТЕНЗИЙ/);
    expect(missing).toMatch(/ПОЧТОВЫЙ АДРЕС/);
    expect(missing).toMatch(/ПЕРЕЧИСЛИТЬ ТОЛЬКО РЕАЛЬНО ПОДКЛЮЧЕННЫЕ/);
  });

  it("условия возврата не сводятся к «косметика возврату не подлежит»", () => {
    expect(fillPlaceholders(OFFER_MD)).toMatch(/Нельзя автоматически отказывать/);
    expect(fillPlaceholders(RETURNS_MD)).not.toMatch(/возврату не подлежат/);
  });
});
