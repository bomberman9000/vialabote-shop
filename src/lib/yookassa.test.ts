import { describe, it, expect, afterEach, vi } from "vitest";
import { buildReceipt, paymentIdempotenceKey, createPayment } from "./yookassa";

const base = {
  orderId: "ord1",
  orderNumber: "V-1",
  amountRub: 570,
  returnUrl: "https://example.test/ok",
  description: "d",
  customerEmail: "a@b.ru",
  receiptItems: [{ description: "Сыворотка", quantity: 2, amountKopecks: 28500 }],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("yookassa: идемпотентность и фискализация", () => {
  it("ключ идемпотентности стабилен для заказа и различается между заказами", () => {
    expect(paymentIdempotenceKey("a")).toBe(paymentIdempotenceKey("a"));
    expect(paymentIdempotenceKey("a")).not.toBe(paymentIdempotenceKey("b"));
  });

  it("чек не формируется, пока продавец не включил фискализацию", () => {
    expect(buildReceipt(base)).toBeUndefined();
  });

  it("фискализация включена без кодов налогообложения -> явная ошибка, не молчаливый чек", () => {
    vi.stubEnv("YOOKASSA_FISCAL_ENABLED", "true");
    expect(() => buildReceipt(base)).toThrow();
  });

  it("при включённой фискализации позиции берутся из серверного заказа", () => {
    vi.stubEnv("YOOKASSA_FISCAL_ENABLED", "true");
    vi.stubEnv("YOOKASSA_TAX_SYSTEM_CODE", "2");
    vi.stubEnv("YOOKASSA_VAT_CODE", "1");
    const r = buildReceipt(base)!;
    expect(r.items).toHaveLength(1);
    expect(r.items[0].quantity).toBe("2");
    expect(r.items[0].amount.value).toBe("285.00");
  });

  it("createPayment повторно отправляет тот же Idempotence-Key", async () => {
    vi.stubEnv("YOOKASSA_SHOP_ID", "s");
    vi.stubEnv("YOOKASSA_SECRET_KEY", "k");
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "p", status: "pending" }) });
    vi.stubGlobal("fetch", f);
    await createPayment(base);
    await createPayment(base);
    const keys = f.mock.calls.map((c) => (c[1] as { headers: Record<string, string> }).headers["Idempotence-Key"]);
    expect(keys[0]).toBe(keys[1]);
  });
});
