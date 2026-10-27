// @vitest-environment node
// Гонки движений склада на НАСТОЯЩЕМ PostgreSQL (блокировки строк, READ COMMITTED, unique-индекс).
// Без DATABASE_URL пропускается; в CI (ZeroHour, seeded Postgres) и локально с временной базой — запускается.
// fake-prisma проверяет логику, но не изоляцию транзакций — поэтому этот файл.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { adjustStock, commitOrder, releaseOrder, reserveForOrder, StockError } from "./movements";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let categoryId = "";
const productIds: string[] = [];
const orderIds: string[] = [];
let seq = 0; // синхронный счётчик: order() вызывается параллельно

async function product(stock: number) {
  const p = await prisma.product.create({
    data: { title: `PG ${suffix} ${++seq}`, slug: `pg-${suffix}-${seq}`, description: "", price: 1000, imageUrl: "/x.png", stock, categoryId },
  });
  productIds.push(p.id);
  return p;
}
async function order() {
  const o = await prisma.order.create({
    data: {
      number: `PG-${suffix}-${++seq}`,
      customerName: "t",
      customerEmail: "t@example.com",
      customerPhone: "+70000000000",
      deliveryCity: "Москва",
      deliveryAddress: "—",
      totalAmount: 1000,
    },
  });
  orderIds.push(o.id);
  return o;
}
const stockOf = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id } })).stock;
const journal = (orderId: string) =>
  prisma.stockChangeLog.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } }).then((r) => r.map((x) => `${x.reason}:${x.delta}`));

describe.skipIf(!HAS_DB)("stock movements on real PostgreSQL", () => {
  beforeAll(async () => {
    categoryId = (await prisma.category.create({ data: { name: `PG ${suffix}`, slug: `pg-${suffix}` } })).id;
  });
  afterAll(async () => {
    await prisma.stockChangeLog.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
  });

  it("cancel vs payment race: payment holds the order lock -> cancel waits and returns nothing", async () => {
    const p = await product(5);
    const o = await order();
    await prisma.$transaction((tx) => reserveForOrder(tx, { orderId: o.id, items: [{ productId: p.id, quantity: 2 }] }));

    const pay = prisma.$transaction(async (tx) => {
      const r = await commitOrder(tx, { orderId: o.id });
      await sleep(400); // держим блокировку заказа, пока отмена уже пришла
      return r;
    });
    await sleep(100);
    const cancel = prisma.$transaction((tx) => releaseOrder(tx, { orderId: o.id }));
    const [paid, cancelled] = await Promise.all([pay, cancel]);

    expect(paid.committed).toEqual([p.id]);
    expect(cancelled).toEqual({ released: [], alreadyReleased: [], committed: [p.id] });
    expect(await stockOf(p.id)).toBe(3);
    expect(await journal(o.id)).toEqual(["RESERVE:-2", "WRITE_OFF:0"]);
  });

  it("payment vs cancel race (other order): cancel first -> payment sees the release, stock returned once", async () => {
    const p = await product(5);
    const o = await order();
    await prisma.$transaction((tx) => reserveForOrder(tx, { orderId: o.id, items: [{ productId: p.id, quantity: 2 }] }));

    const cancel = prisma.$transaction(async (tx) => {
      const r = await releaseOrder(tx, { orderId: o.id });
      await sleep(400);
      return r;
    });
    await sleep(100);
    const pay = prisma.$transaction((tx) => commitOrder(tx, { orderId: o.id }));
    const [cancelled, paid] = await Promise.all([cancel, pay]);

    expect(cancelled.released).toHaveLength(1);
    expect(paid).toEqual({ committed: [], alreadyCommitted: [], releasedBeforePayment: [p.id] });
    expect(await stockOf(p.id)).toBe(5);
    expect(await journal(o.id)).toEqual(["RESERVE:-2", "RELEASE:2"]);
  });

  it("double cancel at the same time returns stock exactly once", async () => {
    const p = await product(5);
    const o = await order();
    await prisma.$transaction((tx) => reserveForOrder(tx, { orderId: o.id, items: [{ productId: p.id, quantity: 3 }] }));
    const results = await Promise.all([1, 2, 3].map(() => prisma.$transaction((tx) => releaseOrder(tx, { orderId: o.id }))));
    expect(results.filter((r) => r.released.length === 1)).toHaveLength(1);
    expect(await stockOf(p.id)).toBe(5);
    expect(await journal(o.id)).toEqual(["RESERVE:-3", "RELEASE:3"]);
  });

  it("10 orders race for 3 units: exactly 3 win, stock never below zero", async () => {
    const p = await product(3);
    const orders = await Promise.all(Array.from({ length: 10 }, () => order()));
    const results = await Promise.allSettled(
      orders.map((o) => prisma.$transaction((tx) => reserveForOrder(tx, { orderId: o.id, items: [{ productId: p.id, quantity: 1 }] }))),
    );
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(won).toHaveLength(3);
    expect(lost).toHaveLength(7);
    for (const l of lost) expect(l.reason).toBeInstanceOf(StockError);
    for (const l of lost) expect((l.reason as StockError).code).toBe("OUT_OF_STOCK");
    expect(await stockOf(p.id)).toBe(0);
    const reserves = await prisma.stockChangeLog.count({ where: { productId: p.id, reason: "RESERVE" } });
    expect(reserves).toBe(3);
  });

  it("concurrent manual edits with the same version: one wins, the other gets VERSION_CONFLICT", async () => {
    const p = await product(5);
    const results = await Promise.allSettled(
      [7, 9].map((n) => prisma.$transaction((tx) => adjustStock(tx, { productId: p.id, expectedVersion: p.version, newStock: n, source: "TELEGRAM" }))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
    expect((lost.reason as StockError).code).toBe("VERSION_CONFLICT");
    expect([7, 9]).toContain(await stockOf(p.id));
    expect(await prisma.stockChangeLog.count({ where: { productId: p.id, reason: "ADJUST" } })).toBe(1);
  });
});
