// Телефон в форме заказа: маска «+7 (999) 123-45-67» при вводе. Проверку мобильного номера
// делает normalizeRuPhone (lib/delivery/ozon) — та же, что на сервере.

/** Цифры номера -> «+7 (999) 123-45-67» по мере ввода. Ведущая 8 и номер без кода страны -> +7. */
export function formatRuPhone(input: string): string {
  let d = input.replace(/\D/g, "");
  if (!d) return "";
  if (d[0] === "8") d = `7${d.slice(1)}`;
  else if (d[0] !== "7") d = `7${d}`;
  const p = d.slice(1, 11);
  let out = `+7 (${p.slice(0, 3)}`;
  if (p.length >= 3) out += ")";
  if (p.length > 3) out += ` ${p.slice(3, 6)}`;
  if (p.length > 6) out += `-${p.slice(6, 8)}`;
  if (p.length > 8) out += `-${p.slice(8, 10)}`;
  return out;
}

/**
 * Новое значение поля с маской. Если покупатель стёр только знак маски («)», «-», пробел), цифры
 * не изменились бы и маска вернула бы знак обратно — тогда стираем последнюю цифру.
 */
export function nextPhoneValue(prev: string, raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (raw.length < prev.length && digits === prev.replace(/\D/g, "")) {
    const shorter = digits.slice(0, -1);
    return shorter.length <= 1 ? "" : formatRuPhone(shorter);
  }
  return formatRuPhone(digits);
}
