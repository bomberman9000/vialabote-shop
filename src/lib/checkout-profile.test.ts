import { describe, it, expect, vi } from "vitest";
import { rememberCheckout, splitFullName, toCheckoutProfile } from "./checkout-profile";

describe("splitFullName — «Имя» из регистрации", () => {
  it("два слова — «Имя Фамилия», одно — только имя, пусто — пусто", () => {
    expect(splitFullName("Елена Шатрова")).toEqual({ lastName: "Шатрова", firstName: "Елена", middleName: "" });
    expect(splitFullName("  Елена  ")).toEqual({ lastName: "", firstName: "Елена", middleName: "" });
    expect(splitFullName(null)).toEqual({ lastName: "", firstName: "", middleName: "" });
  });
  it("три слова — порядок по отчеству", () => {
    expect(splitFullName("Шатрова Елена Петровна")).toEqual({ lastName: "Шатрова", firstName: "Елена", middleName: "Петровна" });
    expect(splitFullName("Иван Ильич Петров")).toEqual({ lastName: "Петров", firstName: "Иван", middleName: "Ильич" });
    expect(splitFullName("Иван Петрович Бабич")).toEqual({ lastName: "Бабич", firstName: "Иван", middleName: "Петрович" });
    expect(splitFullName("Бабич Анна Ильинична")).toEqual({ lastName: "Бабич", firstName: "Анна", middleName: "Ильинична" });
    expect(splitFullName("Анна Мария Луиза")).toEqual({ lastName: "Мария Луиза", firstName: "Анна", middleName: "" });
  });
});

describe("toCheckoutProfile", () => {
  const base = { name: "Елена Шатрова", email: "e@x.ru", phone: "+79270000001", lastName: null, firstName: null, middleName: null, ozonPointId: null };
  it("раздельные поля профиля важнее «Имени» из регистрации", () => {
    expect(toCheckoutProfile({ ...base, lastName: "Иванова", firstName: "Анна" })).toMatchObject({ lastName: "Иванова", firstName: "Анна", middleName: "" });
  });
  it("без раздельных полей — из «Имени»; телефон и пункт как есть", () => {
    expect(toCheckoutProfile({ ...base, ozonPointId: "1237322" })).toEqual({
      lastName: "Шатрова",
      firstName: "Елена",
      middleName: "",
      email: "e@x.ru",
      phone: "+79270000001",
      ozonPointId: "1237322",
    });
  });
});

describe("rememberCheckout", () => {
  it("пишет имя, нормализованный мобильный и пункт; email не трогает", async () => {
    const update = vi.fn().mockResolvedValue({});
    await rememberCheckout({ user: { update } } as never, "u1", {
      name: { lastName: "Шатрова", firstName: "Елена" },
      phone: "8 (927) 000-00-01",
      ozonPointId: "1237322",
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { lastName: "Шатрова", firstName: "Елена", middleName: null, phone: "+79270000001", ozonPointId: "1237322" },
    });
  });
  it("городской номер и пустые поля не затирают профиль", async () => {
    const update = vi.fn().mockResolvedValue({});
    await rememberCheckout({ user: { update } } as never, "u1", { phone: "+7 846 123-45-67" });
    expect(update).toHaveBeenCalledWith({ where: { id: "u1" }, data: {} });
  });
});
