import { describe, it, expect } from "vitest";
import { authorizeUrl, signState, STATE_TTL_MS, verifyState } from "./ozon-oauth";
import { testConfig } from "./__fixtures__/fake-ozon";

const KEY = "app-SECRET";
const T = Date.UTC(2026, 9, 27, 12, 0, 0);

describe("подписанный state", () => {
  it("свой state в пределах срока — принят; после срока, из будущего, чужим ключом, изменённый — нет", () => {
    const s = signState(KEY, T);
    expect(verifyState(s, KEY, T + 60_000)).toBe(true);
    expect(verifyState(s, KEY, T + STATE_TTL_MS + 1)).toBe(false);
    expect(verifyState(signState(KEY, T + 10 * 60_000), KEY, T)).toBe(false);
    expect(verifyState(s, "other-key", T)).toBe(false);
    const [ts, nonce, sig] = s.split(".");
    expect(verifyState(`${ts}.${nonce}x.${sig}`, KEY, T)).toBe(false);
    expect(verifyState(`${(T + 1000).toString(36)}.${nonce}.${sig}`, KEY, T)).toBe(false);
  });
  it("мусор и пустое значение — не принимаются и не бросают", () => {
    for (const s of [null, undefined, "", "abc", "a.b", "a.b.c.d", "ZZZ.b.c", `${T.toString(36)}..`]) expect(verifyState(s, KEY, T)).toBe(false);
  });
  it("каждый раз новый state", () => {
    expect(signState(KEY, T)).not.toBe(signState(KEY, T));
  });
});

describe("ссылка авторизации", () => {
  const cfg = { ...testConfig, app: { ...testConfig.app, clientSecret: KEY, redirectUri: "https://shop.test/ozon-oauth" } };
  it("offline, redirect_uri и scope через пробел, state проверяется тем же ключом; секрет в ссылку не попадает", () => {
    const url = new URL(authorizeUrl(cfg, " a b ", T));
    expect(url.origin + url.pathname).toBe("https://seller.ozon.ru/app/appstore/oauth/authorize");
    const q = url.searchParams;
    expect(q.get("response_type")).toBe("code");
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("client_id")).toBe(cfg.app.clientId);
    expect(q.get("redirect_uri")).toBe("https://shop.test/ozon-oauth");
    expect(q.get("scope")).toBe("a b");
    expect(verifyState(q.get("state"), KEY, T)).toBe(true);
    expect(url.toString()).not.toContain(KEY);
  });
  it("без redirect_uri и для песочницы — ошибка", () => {
    expect(() => authorizeUrl(testConfig, "", T)).toThrow(/OZON_APP_REDIRECT_URI/);
    expect(() => authorizeUrl({ ...cfg, env: "sandbox" }, "", T)).toThrow(/песочниц/);
  });
});
