import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateKeyPairSync, sign } from "crypto";

const h = vi.hoisted(() => ({ db: null as unknown as import("@/lib/telegram/__fixtures__/fake-prisma").FakeDb }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return h.db;
  },
}));

const { FakeDb } = await import("@/lib/telegram/__fixtures__/fake-prisma");
const { placeOnlineOrder } = await import("@/lib/payments/online-order");
const { POST } = await import("./route");
const { GET } = await import("@/app/api/orders/[number]/payment/route");

const bankKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = bankKey.publicKey.export({ format: "jwk" });

function jwt(payload: object, key = bankKey.privateKey) {
  const head = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${head}.${body}.${sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key).toString("base64url")}`;
}

const OP = "11111111-2222-4333-8444-555555555555";
let bankStatus = "APPROVED";
let orderId: string;

beforeEach(async () => {
  process.env.TOCHKA_API_TOKEN = "test-token";
  process.env.TOCHKA_CUSTOMER_CODE = "303256308";
  bankStatus = "APPROVED";
  h.db = new FakeDb();
  const p = await h.db.product.create({ data: { title: "Крем", stock: 3, price: 99000, status: "published", isActive: true } });
  const o = await placeOnlineOrder(
    h.db as never,
    { number: "V-WEBHOOK1", customerName: "Иван", customerEmail: "ivan@example.com", customerPhone: "+79990000000", deliveryCity: "Казань", deliveryAddress: "ул. Секретная, 7", totalAmount: 99000 },
    [{ productId: p.id, title: "Крем", price: 99000, quantity: 1 }],
  );
  orderId = o.id;
  await h.db.order.update({ where: { id: o.id }, data: { paymentId: OP, paymentUrl: "https://pay.test/1" } });
  vi.stubGlobal("fetch", async (url: string) => {
    if (String(url).includes("/keys/public")) return new Response(JSON.stringify(jwk), { status: 200 });
    if (String(url).includes(`/acquiring/v1.0/payments/${OP}`))
      return new Response(JSON.stringify({ Data: { Operation: [{ operationId: OP, status: bankStatus, amount: 990 }] } }), { status: 200 });
    return new Response("not found", { status: 404 });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TOCHKA_API_TOKEN;
  delete process.env.TOCHKA_CUSTOMER_CODE;
});

const post = (body: string) => POST(new Request("http://shop.test/api/payment/tochka/webhook", { method: "POST", body, headers: { "Content-Type": "text/plain" } }));
const orderRow = () => h.db.order.rows.find((r) => r.id === orderId)!;

describe("POST /api/payment/tochka/webhook", () => {
  it("forged signature -> 401 and the order is not touched", async () => {
    const res = await post(jwt({ webhookType: "acquiringInternetPayment", operationId: OP, status: "APPROVED" }, attacker.privateKey));
    expect(res.status).toBe(401);
    expect(orderRow().status).toBe("AWAITING_PAYMENT");
  });

  it("valid signature -> status comes from the bank API: PAID + stock written off; repeat delivery is harmless", async () => {
    const body = jwt({ webhookType: "acquiringInternetPayment", operationId: OP, status: "APPROVED" });
    expect((await post(body)).status).toBe(200);
    expect(orderRow().status).toBe("PAID");
    expect(h.db.stockChangeLog.rows.map((r) => r.reason)).toEqual(["RESERVE", "WRITE_OFF"]);
    expect((await post(body)).status).toBe(200);
    expect(h.db.stockChangeLog.rows).toHaveLength(2);
  });

  it("signed webhook says APPROVED but the bank API says CREATED -> the order keeps waiting", async () => {
    bankStatus = "CREATED";
    expect((await post(jwt({ operationId: OP, status: "APPROVED" }))).status).toBe(200);
    expect(orderRow().status).toBe("AWAITING_PAYMENT");
  });

  it("payments switched off (no Tochka env) -> 404", async () => {
    delete process.env.TOCHKA_API_TOKEN;
    expect((await post(jwt({ operationId: OP }))).status).toBe(404);
  });
});

describe("GET /api/orders/[number]/payment", () => {
  it("returns number, amount, status, deadline and the link — no customer data", async () => {
    bankStatus = "CREATED";
    const res = await GET(new Request("http://shop.test/x"), { params: { number: "V-WEBHOOK1" } });
    const data = await res.json();
    expect(data).toMatchObject({ number: "V-WEBHOOK1", status: "AWAITING_PAYMENT", totalAmount: 99000, paymentUrl: "https://pay.test/1" });
    const text = JSON.stringify(data);
    for (const pii of ["Иван", "ivan@example.com", "+79990000000", "Секретная"]) expect(text).not.toContain(pii);
  });

  it("after 10 minutes the link is no longer handed out and the order is cancelled", async () => {
    bankStatus = "CREATED";
    orderRow().createdAt = new Date(Date.now() - 11 * 60_000);
    const data = await (await GET(new Request("http://shop.test/x"), { params: { number: "V-WEBHOOK1" } })).json();
    expect(data.paymentUrl).toBeNull();
    expect(data.status).toBe("CANCELLED");
  });

  it("garbage order number -> 404 without touching the DB", async () => {
    expect((await GET(new Request("http://shop.test/x"), { params: { number: "../../etc" } })).status).toBe(404);
  });
});
