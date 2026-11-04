import { describe, it, expect } from "vitest";
import { formatRuPhone, nextPhoneValue } from "./phone";
import { normalizeRuPhone } from "@/lib/delivery/ozon";

describe("маска телефона", () => {
  it("форматирует по мере ввода; ведущая 8 и номер без кода -> +7", () => {
    expect(formatRuPhone("")).toBe("");
    expect(formatRuPhone("9")).toBe("+7 (9");
    expect(formatRuPhone("8927")).toBe("+7 (927)");
    expect(formatRuPhone("89270000001")).toBe("+7 (927) 000-00-01");
    expect(formatRuPhone("+7 927 000 00 01")).toBe("+7 (927) 000-00-01");
    expect(formatRuPhone("9270000001")).toBe("+7 (927) 000-00-01");
    expect(formatRuPhone("+7927000000199")).toBe("+7 (927) 000-00-01"); // лишние цифры отбрасываются
  });

  it("результат маски принимает та же проверка, что на сервере", () => {
    expect(normalizeRuPhone(formatRuPhone("89270000001"))).toBe("+79270000001");
    expect(normalizeRuPhone(formatRuPhone("8846123456"))).toBeNull(); // неполный
  });

  it("стирание знака маски стирает цифру; до конца — пустое поле", () => {
    expect(nextPhoneValue("+7 (927)", "+7 (927")).toBe("+7 (92");
    expect(nextPhoneValue("+7 (927) 000-00-01", "+7 (927) 000-00-0")).toBe("+7 (927) 000-00-0");
    expect(nextPhoneValue("+7 (927) 000-0", "+7 (927) 000-")).toBe("+7 (927) 000");
    expect(nextPhoneValue("+7 (9", "+7 (")).toBe("+7 (");
    expect(nextPhoneValue("+7 (", "+7 ")).toBe("");
    expect(nextPhoneValue("", "8")).toBe("+7 (");
  });
});
