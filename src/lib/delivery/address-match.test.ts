import { describe, it, expect } from "vitest";
import { matchesAddress, streetQueryTokens } from "./address-match";

const SVOBODY_2A = "Россия, Самарская Область, Самара, улица Свободы, 2А";
const KIROVA = "Россия, Самарская Область, Самара, проспект Кирова, 10";

describe("поиск пункта по улице и дому", () => {
  it("улица — без учёта регистра, «ул.», окончания и «ё»", () => {
    expect(matchesAddress(SVOBODY_2A, "Свободы")).toBe(true);
    expect(matchesAddress(SVOBODY_2A, "ул. свобода")).toBe(true);
    expect(matchesAddress("Самара, улица Королёва, 1", "королева")).toBe(true);
    expect(matchesAddress(SVOBODY_2A, "Ленина")).toBe(false);
  });

  it("дом — номер целиком, литера допустима: «2» находит «2А», но не «20»", () => {
    expect(matchesAddress(SVOBODY_2A, "Свободы 2")).toBe(true);
    expect(matchesAddress(SVOBODY_2A, "ул. Свободы, д. 2а")).toBe(true);
    expect(matchesAddress("Самара, улица Свободы, 20", "Свободы 2")).toBe(false);
    expect(matchesAddress(SVOBODY_2A, "Свободы 3")).toBe(false);
  });

  it("«пр-т», «б-р» и прочие типы улиц не мешают", () => {
    expect(matchesAddress(KIROVA, "пр-т Кирова 10")).toBe(true);
    expect(matchesAddress(KIROVA, "Кирова, д. 10")).toBe(true);
    expect(streetQueryTokens("пр-т Кирова, д. 10")).toEqual(["кирова", "10"]);
  });

  it("запрос только из «ул.» / «д.» — искать нечего", () => {
    expect(streetQueryTokens("ул. д.")).toEqual([]);
    expect(matchesAddress(SVOBODY_2A, "ул.")).toBe(false);
  });
});
