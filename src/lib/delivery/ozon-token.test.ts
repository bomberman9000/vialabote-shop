// @vitest-environment node
// OAuth-токен на настоящем PostgreSQL: ротация refresh_token, кеш, блокировка строки при обновлении.
import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTokenStore } from "./ozon-token";
import { fakeFetch, testConfig } from "./__fixtures__/fake-ozon";
import { OzonError } from "./ozon";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const rows: string[] = [];
const row = (name: string) => {
  const id = `test-${name}-${suffix}`;
  rows.push(id);
  return id;
};
const cfg = (refreshToken?: string) => ({ ...testConfig, app: { ...testConfig.app, clientSecret: "client-SECRET-xyz", refreshToken, redirectUri: "https://shop.test/ozon/callback" } });

describe.skipIf(!HAS_DB)("OzonOAuthToken (PostgreSQL)", () => {
  afterAll(async () => {
    await prisma.ozonOAuthToken.deleteMany({ where: { id: { in: rows } } });
  });

  it("стартовый refresh_token из env -> обмен, новый refresh_token сохраняется в БД; дальше — кеш", async () => {
    const id = row("rotate");
    let n = 0;
    const fake = fakeFetch({ "/oauth/token": () => ({ body: { access_token: `AT-${++n}`, expires_in: 3600, refresh_token: `RT-${n}`, scope: ["seller-api.delivery"] } }) });
    const store = createTokenStore(cfg("RT-0"), { prisma, fetch: fake.fetch as unknown as typeof fetch, rowId: id });
    expect(await store.getAccessToken()).toBe("AT-1");
    expect(await store.getAccessToken()).toBe("AT-1");
    expect(fake.count("/oauth/token")).toBe(1);
    expect(fake.bodies("/oauth/token")[0]).toEqual({ client_id: "test-app", client_secret: "client-SECRET-xyz", grant_type: "refresh_token", refresh_token: "RT-0" });
    const saved = await prisma.ozonOAuthToken.findUniqueOrThrow({ where: { id } });
    expect(saved).toMatchObject({ accessToken: "AT-1", refreshToken: "RT-1", scope: "seller-api.delivery" });

    // 401 от Ozon -> принудительное обновление уже ротированным токеном
    expect(await store.getAccessToken(true)).toBe("AT-2");
    expect(fake.bodies("/oauth/token")[1].refresh_token).toBe("RT-1");
  });

  it("два процесса с истёкшим токеном: обновление одно (FOR UPDATE + повторная проверка)", async () => {
    const id = row("race");
    await prisma.ozonOAuthToken.create({ data: { id, refreshToken: "RT-A", accessToken: "OLD", expiresAt: new Date(Date.now() - 1000) } });
    const fake = fakeFetch({
      "/oauth/token": async () => {
        await new Promise((r) => setTimeout(r, 150));
        return { body: { access_token: "AT-NEW", expires_in: 3600, refresh_token: "RT-B" } };
      },
    });
    const a = createTokenStore(cfg(), { prisma, fetch: fake.fetch as unknown as typeof fetch, rowId: id });
    const b = createTokenStore(cfg(), { prisma, fetch: fake.fetch as unknown as typeof fetch, rowId: id });
    const [ta, tb] = await Promise.all([a.getAccessToken(), b.getAccessToken()]);
    expect([ta, tb]).toEqual(["AT-NEW", "AT-NEW"]);
    expect(fake.count("/oauth/token")).toBe(1);
    expect((await prisma.ozonOAuthToken.findUniqueOrThrow({ where: { id } })).refreshToken).toBe("RT-B");
  });

  it("недействительный refresh_token: ошибка без секретов, строка не портится", async () => {
    const id = row("invalid");
    await prisma.ozonOAuthToken.create({ data: { id, refreshToken: "RT-DEAD-secret" } });
    const fake = fakeFetch({ "/oauth/token": () => ({ status: 400, body: { message: "invalid_refresh_token" } }) });
    const store = createTokenStore(cfg(), { prisma, fetch: fake.fetch as unknown as typeof fetch, rowId: id });
    const err = (await store.getAccessToken().catch((e) => e)) as OzonError;
    expect(err).toBeInstanceOf(OzonError);
    expect(err.ozonCode).toBe("invalid_refresh_token");
    expect(err.message).not.toMatch(/secret|RT-DEAD/i);
    expect((await prisma.ozonOAuthToken.findUniqueOrThrow({ where: { id } })).refreshToken).toBe("RT-DEAD-secret");
  });

  it("нет ни строки, ни стартового токена -> not_authorized, в Ozon не ходим", async () => {
    const fake = fakeFetch({});
    const store = createTokenStore(cfg(), { prisma, fetch: fake.fetch as unknown as typeof fetch, rowId: row("none") });
    await expect(store.getAccessToken()).rejects.toMatchObject({ ozonCode: "not_authorized" });
    expect(fake.fetch).not.toHaveBeenCalled();
  });

  it("exchangeCode: authorization_code -> токены в БД; без refresh_token — понятная ошибка", async () => {
    const id = row("exchange");
    const ok = fakeFetch({ "/oauth/token": () => ({ body: { access_token: "AT-X", expires_in: 1800, refresh_token: "RT-X", scope: "a b" } }) });
    const store = createTokenStore(cfg(), { prisma, fetch: ok.fetch as unknown as typeof fetch, rowId: id });
    expect(await store.exchangeCode("CODE-1")).toEqual({ expiresIn: 1800, scope: "a b" });
    expect(ok.bodies("/oauth/token")[0]).toMatchObject({ grant_type: "authorization_code", code: "CODE-1", redirect_uri: "https://shop.test/ozon/callback" });
    expect((await prisma.ozonOAuthToken.findUniqueOrThrow({ where: { id } })).refreshToken).toBe("RT-X");

    const online = fakeFetch({ "/oauth/token": () => ({ body: { access_token: "AT-Y", expires_in: 1800 } }) });
    const s2 = createTokenStore(cfg(), { prisma, fetch: online.fetch as unknown as typeof fetch, rowId: row("online") });
    await expect(s2.exchangeCode("CODE-2")).rejects.toThrow(/access_type=offline/);
  });

  it("песочница: client_credentials формой на хост песочницы, токен из БД до истечения, потом новый", async () => {
    const id = row("sandbox");
    let n = 0;
    const fake = fakeFetch({ "/oauth/token": () => ({ body: { access_token: `SB-${++n}`, expires_in: 3600 } }) });
    let t = Date.now();
    const sb = { ...testConfig, env: "sandbox" as const, base: "https://sandbox.test", oauthBase: "https://sandbox.test", app: { clientId: "app", clientSecret: "sb-SECRET" } };
    const store = createTokenStore(sb, { prisma, fetch: fake.fetch as unknown as typeof fetch, rowId: id, now: () => t });
    expect(await store.getAccessToken()).toBe("SB-1");
    const [call] = fake.calls;
    expect(String(fake.fetch.mock.calls[0][0])).toBe("https://sandbox.test/oauth/token");
    expect(call.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(call.body).toEqual({ client_id: "app", client_secret: "sb-SECRET", grant_type: "client_credentials" });
    // другой процесс: токен берётся из БД, без запроса
    const other = createTokenStore(sb, { prisma, fetch: fake.fetch as unknown as typeof fetch, rowId: id, now: () => t });
    expect(await other.getAccessToken()).toBe("SB-1");
    expect(fake.count("/oauth/token")).toBe(1);
    t += 3600_000;
    expect(await other.getAccessToken()).toBe("SB-2");
    const saved = await prisma.ozonOAuthToken.findUniqueOrThrow({ where: { id } });
    expect(saved).toMatchObject({ accessToken: "SB-2", refreshToken: "" });
  });

  it("песочница: форму не приняли (415) — один повтор JSON", async () => {
    const fake = fakeFetch({
      "/oauth/token": (_b, n) => (n === 1 ? { status: 415, body: { message: "unsupported" } } : { body: { access_token: "SB-J", expires_in: 3600 } }),
    });
    const sb = { ...testConfig, env: "sandbox" as const, app: { clientId: "app", clientSecret: "sb" } };
    const store = createTokenStore(sb, { prisma, fetch: fake.fetch as unknown as typeof fetch, rowId: row("sandbox-json") });
    expect(await store.getAccessToken()).toBe("SB-J");
    expect(fake.calls.map((c) => c.headers["Content-Type"])).toEqual(["application/x-www-form-urlencoded", "application/json"]);
  });

  it("по умолчанию строки разные: боевой 'seller', песочница 'sandbox' — смена OZON_ENV не подменит токен", async () => {
    const fake = fakeFetch({ "/oauth/token": () => ({ body: { access_token: "SB-ROW", expires_in: 3600 } }) });
    const sb = { ...testConfig, env: "sandbox" as const, app: { clientId: "app", clientSecret: "sb" } };
    const before = await prisma.ozonOAuthToken.findUnique({ where: { id: "seller" } });
    await createTokenStore(sb, { prisma, fetch: fake.fetch as unknown as typeof fetch }).getAccessToken();
    expect((await prisma.ozonOAuthToken.findUniqueOrThrow({ where: { id: "sandbox" } })).accessToken).toBe("SB-ROW");
    expect(await prisma.ozonOAuthToken.findUnique({ where: { id: "seller" } })).toEqual(before);
    rows.push("sandbox");
  });
});

vi.restoreAllMocks();
