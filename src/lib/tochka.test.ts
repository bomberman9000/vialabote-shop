import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign } from "crypto";
import {
  createPaymentLink,
  getPaymentOperation,
  getTochkaConfig,
  rublesFromKopecks,
  verifyWebhookJwt,
  type FetchLike,
  type TochkaConfig,
} from "./tochka";

const cfg: TochkaConfig = { token: "tkn.secret.value", customerCode: "303256308", apiBase: "https://bank.test/uapi" };

function fakeFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit }[] = []): FetchLike {
  return async (url, init) => {
    seen.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
}

function signJwt(payload: object, privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"], alg = "RS256") {
  const h = Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString("base64url");
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const s = sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url");
  return `${h}.${p}.${s}`;
}

describe("config", () => {
  it("needs token and company customerCode; otherwise payments are off", () => {
    expect(getTochkaConfig({})).toBeNull();
    expect(getTochkaConfig({ TOCHKA_API_TOKEN: "x" })).toBeNull();
    expect(getTochkaConfig({ TOCHKA_API_TOKEN: "x", TOCHKA_CUSTOMER_CODE: "303256308" })).toMatchObject({
      customerCode: "303256308",
      apiBase: "https://enter.tochka.com/uapi",
    });
  });
  it("kopecks -> rubles as a number with cents; rejects junk", () => {
    expect(rublesFromKopecks(123400)).toBe(1234);
    expect(rublesFromKopecks(199)).toBe(1.99);
    expect(() => rublesFromKopecks(0)).toThrow();
    expect(() => rublesFromKopecks(10.5)).toThrow();
  });
});

describe("createPaymentLink", () => {
  it("sends exactly the fields the bank requires, amount in rubles, card first", async () => {
    const seen: { url?: string; init?: RequestInit }[] = [];
    const link = await createPaymentLink(
      cfg,
      { amountKopecks: 249000, purpose: "Оплата заказа V-1", successUrl: "https://s/ok", failUrl: "https://s/fail" },
      fakeFetch(200, { Data: { operationId: "op-1", paymentLink: "https://pay/1" } }, seen),
    );
    expect(link).toEqual({ operationId: "op-1", paymentLink: "https://pay/1" });
    expect(seen[0].url).toBe("https://bank.test/uapi/acquiring/v1.0/payments");
    expect((seen[0].init!.headers as Record<string, string>).Authorization).toBe("Bearer tkn.secret.value");
    const body = JSON.parse(String(seen[0].init!.body));
    expect(body.Data).toEqual({
      customerCode: "303256308",
      amount: 2490,
      purpose: "Оплата заказа V-1",
      paymentMode: ["card", "sbp"],
      redirectUrl: "https://s/ok",
      failRedirectUrl: "https://s/fail",
    });
  });
  it("bank error -> TochkaError without the token in the message", async () => {
    const err = await createPaymentLink(
      cfg,
      { amountKopecks: 100, purpose: "x", successUrl: "a", failUrl: "b" },
      fakeFetch(403, `{"message":"Forbidden by consent","echo":"tkn.secret.value"}`),
    ).catch((e) => e);
    expect(err.name).toBe("TochkaError");
    expect(err.status).toBe(403);
    expect(err.message).not.toContain("tkn.secret.value");
  });
});

describe("getPaymentOperation", () => {
  it("parses the real response shape (Data.Operation[]) and converts the amount to kopecks", async () => {
    const op = await getPaymentOperation(
      cfg,
      "7ea23247-9f9a-4efb-a28d-fd346c1f3b51",
      fakeFetch(200, { Data: { Operation: [{ operationId: "7ea23247-9f9a-4efb-a28d-fd346c1f3b51", status: "APPROVED", amount: 1249.9 }] } }),
    );
    expect(op).toEqual({ operationId: "7ea23247-9f9a-4efb-a28d-fd346c1f3b51", status: "APPROVED", amountKopecks: 124990 });
  });
  it("never lets Next.js cache a bank response (payment status must be live)", async () => {
    const seen: { url?: string; init?: RequestInit }[] = [];
    await getPaymentOperation(cfg, "7ea23247-9f9a-4efb-a28d-fd346c1f3b51", fakeFetch(200, { Data: { Operation: [{ operationId: "7ea23247-9f9a-4efb-a28d-fd346c1f3b51", status: "CREATED", amount: 1 }] } }), );
    await createPaymentLink(cfg, { amountKopecks: 100, purpose: "x", successUrl: "a", failUrl: "b" }, fakeFetch(200, { Data: { operationId: "o", paymentLink: "l" } }, seen));
    await getPaymentOperation(cfg, "7ea23247-9f9a-4efb-a28d-fd346c1f3b51", fakeFetch(200, { Data: { Operation: [{ operationId: "7ea23247-9f9a-4efb-a28d-fd346c1f3b51", status: "CREATED", amount: 1 }] } }, seen));
    expect(seen.map((s) => s.init?.cache)).toEqual(["no-store", "no-store"]);
  });
  it("refuses a malformed operationId before calling the bank", async () => {
    const seen: { url?: string }[] = [];
    await expect(getPaymentOperation(cfg, "../../accounts", fakeFetch(200, {}, seen))).rejects.toThrow();
    expect(seen).toHaveLength(0);
  });
});

describe("verifyWebhookJwt", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });

  it("accepts a JWT signed by the bank key and returns the payload", () => {
    const jwt = signJwt({ webhookType: "acquiringInternetPayment", operationId: "op-1", status: "APPROVED" }, privateKey);
    expect(verifyWebhookJwt(jwt, jwk)).toMatchObject({ operationId: "op-1", status: "APPROVED" });
  });
  it("rejects a JWT signed by someone else, a tampered payload and alg=none", () => {
    expect(verifyWebhookJwt(signJwt({ operationId: "op-1" }, other.privateKey), jwk)).toBeNull();
    const good = signJwt({ operationId: "op-1", amount: 1 }, privateKey).split(".");
    const tampered = [good[0], Buffer.from(JSON.stringify({ operationId: "op-1", amount: 999 })).toString("base64url"), good[2]].join(".");
    expect(verifyWebhookJwt(tampered, jwk)).toBeNull();
    const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from('{"operationId":"x"}').toString("base64url")}.`;
    expect(verifyWebhookJwt(none, jwk)).toBeNull();
    expect(verifyWebhookJwt("not a jwt", jwk)).toBeNull();
  });
});
