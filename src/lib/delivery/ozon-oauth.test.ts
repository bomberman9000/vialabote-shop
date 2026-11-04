// @vitest-environment node
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { authorizeUrl, consumeState, issueState, signState, STATE_TTL_MS, verifyState } from "./ozon-oauth";
import { testConfig } from "./__fixtures__/fake-ozon";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const KEY = "app-SECRET";
const T = Date.UTC(2026, 9, 27, 12, 0, 0);

describe("подпись state", () => {
  it("свой state в пределах срока — nonce; после срока, из будущего, чужим ключом, изменённый — null", () => {
    const s = signState(KEY, T);
    expect(verifyState(s, KEY, T + 60_000)).toBe(s.split(".")[1]);
    expect(verifyState(s, KEY, T + STATE_TTL_MS + 1)).toBeNull();
    expect(verifyState(signState(KEY, T + 10 * 60_000), KEY, T)).toBeNull();
    expect(verifyState(s, "other-key", T)).toBeNull();
    const [ts, nonce, sig] = s.split(".");
    expect(verifyState(`${ts}.${nonce}x.${sig}`, KEY, T)).toBeNull();
    expect(verifyState(`${(T + 1000).toString(36)}.${nonce}.${sig}`, KEY, T)).toBeNull();
  });
  it("мусор и пустое значение — не принимаются и не бросают", () => {
    for (const s of [null, undefined, "", "abc", "a.b", "a.b.c.d", "ZZZ.b.c", `${T.toString(36)}..`]) expect(verifyState(s, KEY, T)).toBeNull();
  });
  it("каждый раз новый state", () => {
    expect(signState(KEY, T)).not.toBe(signState(KEY, T));
  });
});

describe.skipIf(!HAS_DB)("одноразовый state (PostgreSQL)", () => {
  const issued: string[] = [];
  const issue = async (now = Date.now()) => {
    const s = await issueState(prisma, KEY, now);
    issued.push(s.split(".")[1]);
    return s;
  };
  afterAll(async () => {
    await prisma.ozonOAuthState.deleteMany({ where: { nonce: { in: issued } } });
  });

  it("выданный state гасится ровно один раз, даже при двух одновременных запросах", async () => {
    const s = await issue();
    const both = await Promise.all([consumeState(prisma, s, KEY), consumeState(prisma, s, KEY)]);
    expect(both.filter(Boolean)).toHaveLength(1);
    expect(await consumeState(prisma, s, KEY)).toBe(false);
  });
  it("подписан верно, но не выдан скриптом (нет в БД) — отказ", async () => {
    expect(await consumeState(prisma, signState(KEY), KEY)).toBe(false);
  });
  it("просроченный — отказ, и следующий issueState убирает его из БД", async () => {
    const old = await issue(Date.now() - STATE_TTL_MS - 1000);
    expect(await consumeState(prisma, old, KEY)).toBe(false);
    await issue();
    expect(await prisma.ozonOAuthState.findUnique({ where: { nonce: old.split(".")[1] } })).toBeNull();
  });
  it("чужой ключ — отказ без обращения к выданному nonce", async () => {
    const s = await issue();
    expect(await consumeState(prisma, s, "other-key")).toBe(false);
    expect(await consumeState(prisma, s, KEY)).toBe(true);
  });
});

describe("ссылка авторизации", () => {
  const cfg = { ...testConfig, app: { ...testConfig.app, clientSecret: KEY, redirectUri: "https://shop.test/ozon-oauth" } };
  it("offline, redirect_uri, scope через пробел и переданный state; секрет в ссылку не попадает", () => {
    const state = signState(KEY, T);
    const url = new URL(authorizeUrl(cfg, " a b ", state));
    expect(url.origin + url.pathname).toBe("https://seller.ozon.ru/app/appstore/oauth/authorize");
    const q = url.searchParams;
    expect(q.get("response_type")).toBe("code");
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("client_id")).toBe(cfg.app.clientId);
    expect(q.get("redirect_uri")).toBe("https://shop.test/ozon-oauth");
    expect(q.get("scope")).toBe("a b");
    expect(q.get("state")).toBe(state);
    expect(url.toString()).not.toContain(KEY);
  });
  it("без redirect_uri и для песочницы — ошибка", () => {
    expect(() => authorizeUrl(testConfig, "", "s")).toThrow(/OZON_APP_REDIRECT_URI/);
    expect(() => authorizeUrl({ ...cfg, env: "sandbox" }, "", "s")).toThrow(/песочниц/);
  });
});
