// @vitest-environment node
// redirect_uri частного приложения: code меняется на токен только по одноразовому state, выданному нашим скриптом.
import { describe, it, expect, afterEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { OzonError } from "@/lib/delivery/ozon";
import { issueState, signState, STATE_TTL_MS } from "@/lib/delivery/ozon-oauth";
import { resetRequestLimits } from "@/lib/delivery/ozon-service";

const HAS_DB = Boolean(process.env.DATABASE_URL);

const exchangeCode = vi.fn(async (code: string) => {
  void code;
  return { expiresIn: 3600, scope: "a b" };
});
const created: unknown[] = [];
vi.mock("@/lib/delivery/ozon-token", () => ({
  createTokenStore: (cfg: unknown) => {
    created.push(cfg);
    return { getAccessToken: async () => "t", exchangeCode };
  },
}));

const { GET } = await import("./route");

const SECRET = "prod-SECRET";
const on = () => {
  vi.stubEnv("OZON_APP_CLIENT_ID", "app");
  vi.stubEnv("OZON_APP_CLIENT_SECRET", SECRET);
  vi.stubEnv("OZON_APP_REDIRECT_URI", "https://shop.test/ozon-oauth");
};
const issued: string[] = [];
const issue = async (now?: number) => {
  const s = await issueState(prisma, SECRET, now);
  issued.push(s.split(".")[1]);
  return s;
};
let ip = 0;
const get = (q: Record<string, string>) =>
  GET(new Request(`http://localhost/ozon-oauth?${new URLSearchParams(q)}`, { headers: { "x-forwarded-for": `10.1.0.${++ip}` } }));

afterEach(() => {
  vi.unstubAllEnvs();
  exchangeCode.mockClear();
  created.length = 0;
  resetRequestLimits();
});

describe.skipIf(!HAS_DB)("/ozon-oauth", () => {
  afterAll(async () => {
    await prisma.ozonOAuthState.deleteMany({ where: { nonce: { in: issued } } });
  });

  it("выданный state -> code обменян боевым приложением, страница без токена и секрета; повтор адреса — отказ без обмена", async () => {
    on();
    vi.stubEnv("OZON_ENV", "sandbox"); // ссылка всегда боевая, OZON_ENV не влияет
    vi.stubEnv("OZON_APP_CLIENT_SECRET_SANDBOX", "sb");
    const state = await issue();
    const res = await get({ code: "CODE-1", state });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("Ozon подключён");
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain("CODE-1");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(exchangeCode).toHaveBeenCalledWith("CODE-1");
    expect(created[0]).toMatchObject({ env: "prod", app: { clientSecret: SECRET } });

    // тот же state (например, из журнала nginx) с другим code — токен не перезаписывается
    const replay = await get({ code: "ATTACKER-CODE", state });
    expect(replay.status).toBe(400);
    expect(exchangeCode).toHaveBeenCalledTimes(1);
  });

  it("подписан нашим ключом, но не выдан скриптом; чужой ключ; просроченный; пустой -> 400, обмена нет", async () => {
    on();
    const expired = await issue(Date.now() - STATE_TTL_MS - 1000);
    for (const state of ["", "x.y.z", signState(SECRET), signState("other-secret"), expired]) {
      expect((await get({ code: "CODE-2", state })).status).toBe(400);
    }
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("отказ Ozon (error=…) и нет code -> 400, state погашен", async () => {
    on();
    const s1 = await issue();
    expect((await get({ error: "access_denied", state: s1 })).status).toBe(400);
    expect((await get({ code: "C", state: s1 })).status).toBe(400);
    expect((await get({ state: await issue() })).status).toBe(400);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("не настроено -> 503; ошибка обмена -> 502 с методом и HTTP-кодом, без секрета", async () => {
    expect((await get({ code: "C", state: "s" })).status).toBe(503);
    on();
    exchangeCode.mockRejectedValueOnce(new OzonError("/oauth/token", 400));
    const res = await get({ code: "C", state: await issue() });
    const html = await res.text();
    expect(res.status).toBe(502);
    expect(html).toContain("/oauth/token");
    expect(html).toContain("HTTP 400");
    expect(html).not.toContain(SECRET);
  });

  it("частота: не больше 10 запросов в минуту с адреса", async () => {
    on();
    const req = () => GET(new Request("http://localhost/ozon-oauth?state=x", { headers: { "x-forwarded-for": "10.2.0.1" } }));
    for (let i = 0; i < 10; i++) expect((await req()).status).toBe(400);
    expect((await req()).status).toBe(429);
  });
});
