// @vitest-environment node
// redirect_uri частного приложения: code меняется на токен только по state, подписанному нашим скриптом.
import { describe, it, expect, afterEach, vi } from "vitest";
import { OzonError } from "@/lib/delivery/ozon";
import { signState } from "@/lib/delivery/ozon-oauth";
import { resetRequestLimits } from "@/lib/delivery/ozon-service";

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
let ip = 0;
const get = (q: Record<string, string>) =>
  GET(new Request(`http://localhost/ozon-oauth?${new URLSearchParams(q)}`, { headers: { "x-forwarded-for": `10.1.0.${++ip}` } }));

afterEach(() => {
  vi.unstubAllEnvs();
  exchangeCode.mockClear();
  created.length = 0;
  resetRequestLimits();
});

describe("/ozon-oauth", () => {
  it("верный state -> code обменян боевым приложением, страница без токена и секрета; повтор не тратит code", async () => {
    on();
    vi.stubEnv("OZON_ENV", "sandbox"); // ссылка всегда боевая, OZON_ENV не влияет
    vi.stubEnv("OZON_APP_CLIENT_SECRET_SANDBOX", "sb");
    const state = signState(SECRET);
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

    const again = await get({ code: "CODE-1", state });
    expect(await again.text()).toContain("уже подключён");
    expect(exchangeCode).toHaveBeenCalledTimes(1);
  });

  it("чужой, просроченный или пустой state -> 400, обмена нет", async () => {
    on();
    for (const state of ["", "x.y.z", signState("other-secret"), signState(SECRET, Date.now() - 31 * 60_000)]) {
      const res = await get({ code: "CODE-2", state });
      expect(res.status).toBe(400);
    }
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("отказ Ozon (error=…) и нет code -> 400", async () => {
    on();
    expect((await get({ error: "access_denied", state: signState(SECRET) })).status).toBe(400);
    expect((await get({ state: signState(SECRET) })).status).toBe(400);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("не настроено -> 503; ошибка обмена -> 502 с методом и HTTP-кодом, без секрета", async () => {
    expect((await get({ code: "C", state: "s" })).status).toBe(503);
    on();
    exchangeCode.mockRejectedValueOnce(new OzonError("/oauth/token", 400));
    const res = await get({ code: "C", state: signState(SECRET) });
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
