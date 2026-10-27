// @vitest-environment node
// Движения склада на in-memory Prisma (fake-prisma): транзакции с откатом, unique-индекс журнала.
import { describe, it, expect, beforeEach } from "vitest";
import { FakeDb } from "@/lib/telegram/__fixtures__/fake-prisma";
import {
  adjustStock,
  commitOrder,
  isDuplicateMovement,
  normalizeLines,
  releaseOrder,
  reserveForOrder,
  StockError,
  type Tx,
} from "./movements";

let db: FakeDb;
const tx = () => db as unknown as Tx;
const stock = (id: string) => db.product.rows.find((p) => p.id === id)!.stock as number;
const log = () => db.stockChangeLog.rows.map((r) => [r.reason, r.productId, r.delta, r.orderId]);
/** Инвариант журнала: текущий остаток = начальный + сумма delta по товару. */
const ledgerHolds = (id: string, initial: number) =>
  initial + db.stockChangeLog.rows.filter((r) => r.productId === id).reduce((a, r) => a + r.delta, 0) === stock(id);

beforeEach(async () => {
  db = new FakeDb();
  await db.product.create({ data: { id: "pA", title: "A", stock: 5, version: 1 } });
  await db.product.create({ data: { id: "pB", title: "B", stock: 1, version: 1 } });
});

describe("reserveForOrder", () => {
  it("decrements stock, bumps version, logs RESERVE per line (duplicates merged)", async () => {
    const r = await db.$transaction((t) =>
      reserveForOrder(t as unknown as Tx, { orderId: "o1", items: [{ productId: "pA", quantity: 2 }, { productId: "pB", quantity: 1 }, { productId: "pA", quantity: 1 }] }),
    );
    expect(r).toEqual({
      alreadyReserved: false,
      lines: [
        { productId: "pA", quantity: 3, stockAfter: 2 },
        { productId: "pB", quantity: 1, stockAfter: 0 },
      ],
    });
    expect([stock("pA"), stock("pB")]).toEqual([2, 0]);
    expect(db.product.rows.find((p) => p.id === "pA")!.version).toBe(2);
    expect(log()).toEqual([
      ["RESERVE", "pA", -3, "o1"],
      ["RESERVE", "pB", -1, "o1"],
    ]);
    expect(db.stockChangeLog.rows[0]).toMatchObject({ oldStock: 5, newStock: 2, source: "SITE_ORDER" });
  });

  it("shortage: OUT_OF_STOCK with details and the WHOLE transaction rolls back (order too)", async () => {
    const err = await db
      .$transaction(async (t) => {
        await t.order.create({ data: { id: "o2", number: "2", status: "NEW" } });
        return reserveForOrder(t as unknown as Tx, { orderId: "o2", items: [{ productId: "pA", quantity: 2 }, { productId: "pB", quantity: 2 }] });
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(StockError);
    expect(err).toMatchObject({ code: "OUT_OF_STOCK", details: { productId: "pB", requested: 2, available: 1 } });
    expect([stock("pA"), stock("pB")]).toEqual([5, 1]); // pA уже было списано внутри — откатилось
    expect(db.order.rows).toHaveLength(0);
    expect(db.stockChangeLog.rows).toHaveLength(0);
  });

  it("repeat for the same order changes nothing", async () => {
    await reserveForOrder(tx(), { orderId: "o1", items: [{ productId: "pA", quantity: 2 }] });
    const again = await reserveForOrder(tx(), { orderId: "o1", items: [{ productId: "pA", quantity: 2 }] });
    expect(again.alreadyReserved).toBe(true);
    expect(stock("pA")).toBe(3);
    expect(db.stockChangeLog.rows).toHaveLength(1);
  });

  it("race: two orders for the last unit — exactly one wins (conditional update, not read-then-write)", async () => {
    // без транзакций, чтобы вызовы реально перемежались на await
    const results = await Promise.allSettled([
      reserveForOrder(tx(), { orderId: "r1", items: [{ productId: "pB", quantity: 1 }] }),
      reserveForOrder(tx(), { orderId: "r2", items: [{ productId: "pB", quantity: 1 }] }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: "OUT_OF_STOCK" });
    expect(stock("pB")).toBe(0); // никогда не -1
    expect(log()).toHaveLength(1);
  });

  it("race inside transactions: same outcome, loser fully rolled back", async () => {
    const results = await Promise.allSettled(
      ["t1", "t2"].map((orderId) =>
        db.$transaction(async (t) => {
          await t.order.create({ data: { id: orderId, number: orderId } });
          return reserveForOrder(t as unknown as Tx, { orderId, items: [{ productId: "pB", quantity: 1 }] });
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(stock("pB")).toBe(0);
    expect(db.order.rows).toHaveLength(1);
  });

  it.each([
    [[], "нет позиций"],
    [[{ productId: "pA", quantity: 0 }], "положительным"],
    [[{ productId: "pA", quantity: 1.5 }], "положительным"],
  ])("invalid lines %j rejected", async (items, msg) => {
    await expect(reserveForOrder(tx(), { orderId: "x", items })).rejects.toThrow(msg);
  });

  it("unknown product -> NOT_FOUND", async () => {
    await expect(reserveForOrder(tx(), { orderId: "x", items: [{ productId: "nope", quantity: 1 }] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lines are merged and sorted by id (same lock order for every order)", () => {
    expect(normalizeLines([{ productId: "b", quantity: 1 }, { productId: "a", quantity: 2 }, { productId: "b", quantity: 3 }])).toEqual([
      { productId: "a", quantity: 2 },
      { productId: "b", quantity: 4 },
    ]);
  });
});

describe("releaseOrder", () => {
  it("returns the reserve once; second call is a no-op", async () => {
    await reserveForOrder(tx(), { orderId: "o1", items: [{ productId: "pA", quantity: 3 }] });
    const first = await releaseOrder(tx(), { orderId: "o1" });
    expect(first).toEqual({ released: [{ productId: "pA", quantity: 3, stockAfter: 5 }], alreadyReleased: [], committed: [] });
    const second = await releaseOrder(tx(), { orderId: "o1" });
    expect(second).toEqual({ released: [], alreadyReleased: ["pA"], committed: [] });
    expect(stock("pA")).toBe(5);
    expect(log()).toEqual([
      ["RESERVE", "pA", -3, "o1"],
      ["RELEASE", "pA", 3, "o1"],
    ]);
    expect(ledgerHolds("pA", 5)).toBe(true);
  });

  it("order without reserve (legacy order) -> empty result, no error", async () => {
    expect(await releaseOrder(tx(), { orderId: "legacy" })).toEqual({ released: [], alreadyReleased: [], committed: [] });
  });

  it("does not return goods of a paid (committed) order", async () => {
    await reserveForOrder(tx(), { orderId: "o1", items: [{ productId: "pA", quantity: 2 }] });
    await commitOrder(tx(), { orderId: "o1" });
    expect(await releaseOrder(tx(), { orderId: "o1" })).toEqual({ released: [], alreadyReleased: [], committed: ["pA"] });
    expect(stock("pA")).toBe(3);
  });

  it("concurrent duplicate release: unique index stops the second, its transaction rolls back", async () => {
    await reserveForOrder(tx(), { orderId: "o1", items: [{ productId: "pA", quantity: 2 }] });
    // имитируем гонку: строка RELEASE появилась между нашей проверкой и записью
    const results = await Promise.allSettled([
      releaseOrder(tx(), { orderId: "o1" }),
      releaseOrder(tx(), { orderId: "o1" }),
    ]);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    // без транзакции второй мог успеть увеличить stock до падения на unique — поэтому
    // в проде release всегда вызывается внутри $transaction (проверено ниже)
    expect(rejected).toHaveLength(1);
    expect(isDuplicateMovement(rejected[0].reason)).toBe(true);
    expect(db.stockChangeLog.rows.filter((r) => r.reason === "RELEASE")).toHaveLength(1);
  });

  it("concurrent duplicate release inside transactions: stock returned exactly once", async () => {
    await reserveForOrder(tx(), { orderId: "o1", items: [{ productId: "pA", quantity: 2 }] });
    await Promise.allSettled([1, 2].map(() => db.$transaction((t) => releaseOrder(t as unknown as Tx, { orderId: "o1" }))));
    expect(stock("pA")).toBe(5);
    expect(ledgerHolds("pA", 5)).toBe(true);
  });
});

describe("commitOrder", () => {
  it("writes WRITE_OFF with delta 0, stock unchanged; repeat is a no-op", async () => {
    await reserveForOrder(tx(), { orderId: "o1", items: [{ productId: "pA", quantity: 2 }, { productId: "pB", quantity: 1 }] });
    expect(await commitOrder(tx(), { orderId: "o1" })).toEqual({ committed: ["pA", "pB"], alreadyCommitted: [], releasedBeforePayment: [] });
    expect(await commitOrder(tx(), { orderId: "o1" })).toEqual({ committed: [], alreadyCommitted: ["pA", "pB"], releasedBeforePayment: [] });
    expect([stock("pA"), stock("pB")]).toEqual([3, 0]);
    const wo = db.stockChangeLog.rows.filter((r) => r.reason === "WRITE_OFF");
    expect(wo.map((r) => [r.productId, r.delta, r.source])).toEqual([
      ["pA", 0, "PAYMENT_WEBHOOK"],
      ["pB", 0, "PAYMENT_WEBHOOK"],
    ]);
  });

  it("payment after cancellation: reported, stock untouched", async () => {
    await reserveForOrder(tx(), { orderId: "o1", items: [{ productId: "pA", quantity: 2 }] });
    await releaseOrder(tx(), { orderId: "o1" });
    expect(await commitOrder(tx(), { orderId: "o1" })).toEqual({ committed: [], alreadyCommitted: [], releasedBeforePayment: ["pA"] });
    expect(stock("pA")).toBe(5);
  });
});

describe("adjustStock", () => {
  it("sets stock under OCC and logs ADJUST without orderId", async () => {
    const { after } = await adjustStock(tx(), { productId: "pA", expectedVersion: 1, newStock: 9, source: "TELEGRAM", actorUserId: "u1", actorTelegramUserId: "42" });
    expect(after.stock).toBe(9);
    expect(db.stockChangeLog.rows[0]).toMatchObject({ reason: "ADJUST", orderId: null, delta: 4, oldStock: 5, newStock: 9, actorTelegramUserId: "42" });
  });

  it("several ADJUST rows for one product are fine (NULL orderId does not hit the unique index)", async () => {
    await adjustStock(tx(), { productId: "pA", expectedVersion: 1, newStock: 6, source: "TELEGRAM" });
    await adjustStock(tx(), { productId: "pA", expectedVersion: 2, newStock: 7, source: "TELEGRAM" });
    expect(db.stockChangeLog.rows).toHaveLength(2);
  });

  it("a reservation made after the bot preview invalidates it (version conflict)", async () => {
    await reserveForOrder(tx(), { orderId: "o1", items: [{ productId: "pA", quantity: 1 }] }); // version 1 -> 2
    await expect(adjustStock(tx(), { productId: "pA", expectedVersion: 1, newStock: 10, source: "TELEGRAM" })).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
    expect(stock("pA")).toBe(4);
  });

  it.each([-1, 1.5, 100_001])("rejects %s", async (n) => {
    await expect(adjustStock(tx(), { productId: "pA", expectedVersion: 1, newStock: n, source: "TELEGRAM" })).rejects.toMatchObject({ code: "INVALID" });
  });
});
