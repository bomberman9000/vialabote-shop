import { describe, it, expect, beforeEach } from "vitest";
import { FakeDb } from "@/lib/telegram/__fixtures__/fake-prisma";
import type { FetchLike, TochkaConfig } from "@/lib/tochka";
import {
  PAYMENT_WINDOW_MS,
  cancelUnpaidOrder,
  placeOnlineOrder,
  sweepExpiredOrders,
  syncOrderPayment,
  type OrderRow,
} from "./online-order";

const cfg: TochkaConfig = { token: "t", customerCode: "303256308", apiBase: "https://bank.test/uapi" };
const T0 = new Date("2026-10-27T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

/** Банк-заглушка: статус и сумма операции, счётчик обращений. */
function bank(status: string, amountRub: number) {
  const calls = { n: 0 };
  const fetchImpl: FetchLike = async (url) => {
    calls.n++;
    const id = String(url).split("/").pop();
    return new Response(JSON.stringify({ Data: { Operation: [{ operationId: id, status, amount: amountRub }] } }), { status: 200 });
  };
  return { fetchImpl, calls };
}

let db: FakeDb;
let productId: string;

async function order(qty = 2, createdAt = T0): Promise<OrderRow> {
  const o = await placeOnlineOrder(
    db as never,
    {
      number: `V-T${db.order.rows.length + 1}`,
      customerName: "Тест",
      customerEmail: "t@example.com",
      customerPhone: "+70000000000",
      deliveryCity: "Москва",
      deliveryAddress: "ул. Тестовая, 1",
      totalAmount: 150000 * qty,
    },
    [{ productId, title: "Сыворотка", price: 150000, quantity: qty }],
  );
  const row = db.order.rows.find((r) => r.id === o.id)!;
  row.createdAt = createdAt;
  row.paymentId = `aaaaaaaa-0000-4000-8000-00000000000${db.order.rows.length}`;
  return { ...row } as OrderRow;
}
const fresh = (o: OrderRow) => ({ ...db.order.rows.find((r) => r.id === o.id)! }) as OrderRow;
const stock = () => db.product.rows.find((p) => p.id === productId)!.stock;
const journal = (o: OrderRow) => db.stockChangeLog.rows.filter((r) => r.orderId === o.id).map((r) => `${r.reason}:${r.delta}`);

beforeEach(async () => {
  db = new FakeDb();
  const p = await db.product.create({ data: { title: "Сыворотка", stock: 5, price: 150000, status: "published", isActive: true } });
  productId = p.id;
});

describe("placeOnlineOrder", () => {
  it("creates the order AWAITING_PAYMENT, its items and reserves the stock in one go", async () => {
    const o = await order(2);
    expect(o.status).toBe("AWAITING_PAYMENT");
    expect(db.orderItem.rows).toHaveLength(1);
    expect(stock()).toBe(3);
    expect(journal(o)).toEqual(["RESERVE:-2"]);
  });
  it("not enough stock -> OUT_OF_STOCK and nothing is created (no order, no items, no reserve)", async () => {
    await expect(order(6)).rejects.toMatchObject({ code: "OUT_OF_STOCK" });
    expect(db.order.rows).toHaveLength(0);
    expect(db.orderItem.rows).toHaveLength(0);
    expect(stock()).toBe(5);
  });
});

describe("syncOrderPayment", () => {
  it("bank APPROVED with the right amount -> PAID + WRITE_OFF; repeat changes nothing", async () => {
    const o = await order(2);
    const b = bank("APPROVED", 3000);
    expect(await syncOrderPayment(db as never, o, { cfg, fetchImpl: b.fetchImpl, now: at(60_000) })).toBe("PAID");
    expect(fresh(o).status).toBe("PAID");
    expect(stock()).toBe(3);
    expect(journal(o)).toEqual(["RESERVE:-2", "WRITE_OFF:0"]);
    expect(await syncOrderPayment(db as never, fresh(o), { cfg, fetchImpl: b.fetchImpl })).toBe("UNCHANGED");
    expect(journal(o)).toHaveLength(2);
  });

  it("bank confirms a different amount -> nothing changes (manual check)", async () => {
    const o = await order(2);
    expect(await syncOrderPayment(db as never, o, { cfg, fetchImpl: bank("APPROVED", 1).fetchImpl, now: at(1000) })).toBe("AMOUNT_MISMATCH");
    expect(fresh(o).status).toBe("AWAITING_PAYMENT");
    expect(journal(o)).toEqual(["RESERVE:-2"]);
  });

  it("not paid yet inside 10 minutes -> WAITING, reserve kept", async () => {
    const o = await order(2);
    expect(await syncOrderPayment(db as never, o, { cfg, fetchImpl: bank("CREATED", 3000).fetchImpl, now: at(PAYMENT_WINDOW_MS - 1000) })).toBe("WAITING");
    expect(stock()).toBe(3);
  });

  it("10 minutes passed without payment -> CANCELLED and the goods are back on sale", async () => {
    const o = await order(2);
    expect(await syncOrderPayment(db as never, o, { cfg, fetchImpl: bank("CREATED", 3000).fetchImpl, now: at(PAYMENT_WINDOW_MS + 1000) })).toBe("EXPIRED");
    expect(fresh(o).status).toBe("CANCELLED");
    expect(stock()).toBe(5);
    expect(journal(o)).toEqual(["RESERVE:-2", "RELEASE:2"]);
    expect(fresh(o).comment).toContain("не оплачен за 10 минут");
  });

  it("payment arrives after the timer cancelled the order -> PAID_LATE, stock untouched, owner note", async () => {
    const o = await order(2);
    await syncOrderPayment(db as never, o, { cfg, fetchImpl: bank("CREATED", 3000).fetchImpl, now: at(PAYMENT_WINDOW_MS + 1000) });
    expect(await syncOrderPayment(db as never, fresh(o), { cfg, fetchImpl: bank("APPROVED", 3000).fetchImpl })).toBe("PAID_LATE");
    expect(fresh(o).status).toBe("PAID");
    expect(stock()).toBe(5);
    expect(fresh(o).comment).toContain("проверьте наличие");
  });

  it("webhook and the payment page confirm at the same time -> exactly one WRITE_OFF", async () => {
    const o = await order(2);
    const b = bank("APPROVED", 3000);
    const r = await Promise.all([
      syncOrderPayment(db as never, o, { cfg, fetchImpl: b.fetchImpl }),
      syncOrderPayment(db as never, o, { cfg, fetchImpl: b.fetchImpl }),
    ]);
    expect(r.sort()).toEqual(["PAID", "UNCHANGED"]);
    expect(journal(o)).toEqual(["RESERVE:-2", "WRITE_OFF:0"]);
  });

  it("cancel and payment race: the stock is either returned or written off, never both", async () => {
    const o = await order(2);
    await Promise.all([
      cancelUnpaidOrder(db as never, o.id, "отмена"),
      syncOrderPayment(db as never, o, { cfg, fetchImpl: bank("APPROVED", 3000).fetchImpl }),
    ]);
    const j = journal(o);
    expect(j.filter((x) => x.startsWith("RELEASE")).length + j.filter((x) => x.startsWith("WRITE_OFF")).length).toBe(1);
  });
});

describe("owner notification hook", () => {
  it("fires exactly once on PAID, never on a repeat or while waiting", async () => {
    const o = await order(2);
    const seen: string[] = [];
    const onOutcome = (_o: OrderRow, r: string) => seen.push(r);
    await syncOrderPayment(db as never, o, { cfg, fetchImpl: bank("CREATED", 3000).fetchImpl, now: at(1000), onOutcome });
    await syncOrderPayment(db as never, o, { cfg, fetchImpl: bank("APPROVED", 3000).fetchImpl, onOutcome });
    await syncOrderPayment(db as never, fresh(o), { cfg, fetchImpl: bank("APPROVED", 3000).fetchImpl, onOutcome });
    expect(seen).toEqual(["PAID"]);
  });
});

describe("sweep confirms a paid order even if the buyer never came back", () => {
  it("young AWAITING order paid at the bank -> PAID by the sweep", async () => {
    const o = await order(1, at(-60_000));
    expect(await sweepExpiredOrders(db as never, { cfg, fetchImpl: bank("APPROVED", 1500).fetchImpl, now: T0 })).toBe(1);
    expect(fresh(o).status).toBe("PAID");
  });
});

describe("sweepExpiredOrders", () => {
  it("cancels only orders past their 10 minutes and returns their stock", async () => {
    const old = await order(1, at(-PAYMENT_WINDOW_MS - 60_000));
    const young = await order(1, at(-60_000));
    const b = bank("CREATED", 1500);
    expect(await sweepExpiredOrders(db as never, { cfg, fetchImpl: b.fetchImpl, now: T0 })).toBe(1);
    expect(fresh(old).status).toBe("CANCELLED");
    expect(fresh(young).status).toBe("AWAITING_PAYMENT");
    expect(stock()).toBe(4);
  });
});
