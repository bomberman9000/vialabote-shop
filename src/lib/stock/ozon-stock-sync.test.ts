// @vitest-environment node
// Остатки сайта <-> склад FBS Ozon на настоящем PostgreSQL с поддельным Ozon.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { fakeFetch, testOzon } from "@/lib/delivery/__fixtures__/fake-ozon";
import { syncOzonStock } from "./ozon-stock-sync";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const sx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const env = { OZON_FBS_WAREHOUSE_ID: "555" } as unknown as NodeJS.ProcessEnv;
let categoryId = "";
let pid = "";

describe.skipIf(!HAS_DB)("синхронизация остатков с Ozon", () => {
  beforeAll(async () => {
    await prisma.ozonMarketplacePosting.deleteMany({});
    categoryId = (await prisma.category.create({ data: { name: `SS ${sx}`, slug: `ss-${sx}` } })).id;
    pid = (await prisma.product.create({ data: { title: `SS ${sx}`, slug: `ss-${sx}`, description: "", price: 50000, imageUrl: "/x.png", stock: 10, status: "published", isActive: true, categoryId, ozonSku: "990001", ozonOfferId: `SS-${sx}` } })).id;
    const o = await prisma.order.create({ data: { number: `SS-${sx}`, customerName: "x", customerEmail: "x@x.ru", customerPhone: "+79990000000", deliveryCity: "x", deliveryAddress: "x", totalAmount: 1, status: "PAID" } });
    await prisma.ozonOrder.create({ data: { orderId: o.id, deliveryType: "PVZ", request: {}, quote: {}, state: "CREATED", ozonOrderNumber: `SITE-${sx}` } });
  });
  afterAll(async () => {
    await prisma.ozonMarketplacePosting.deleteMany({});
    await prisma.stockChangeLog.deleteMany({ where: { productId: pid } });
    const o = await prisma.order.findUnique({ where: { number: `SS-${sx}` } });
    if (o) { await prisma.ozonOrder.deleteMany({ where: { orderId: o.id } }); await prisma.order.delete({ where: { id: o.id } }); }
    await prisma.product.deleteMany({ where: { id: pid } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
  });

  const posting = (n: string, status: string, qty = 2, order = `MP-${n}`) => ({ posting_number: `${n}-${sx}`, order_number: order, status, products: [{ offer_id: `SS-${sx}`, quantity: qty }] });
  const world = (postings: unknown[]) =>
    fakeFetch({
      "/v4/posting/fbs/list": () => ({ body: { postings, has_next: false } }),
      "/v2/products/stocks": (b: { stocks: { offer_id: string }[] }) => ({ body: { result: b.stocks.map((s) => ({ offer_id: s.offer_id, updated: true })) } }),
    });
  const stock = async () => (await prisma.product.findUniqueOrThrow({ where: { id: pid } })).stock;

  it("первый запуск: старые отправления только запоминаются, остаток сайта уходит в Ozon", async () => {
    const fake = world([posting("old", "delivered")]);
    const r = await syncOzonStock(testOzon(fake), env);
    expect(r).toMatchObject({ writtenOff: 0, returned: 0, errors: [] });
    expect(await stock()).toBe(10);
    const sent = fake.bodies("/v2/products/stocks")[0].stocks.find((s: { offer_id: string }) => s.offer_id === `SS-${sx}`);
    expect(sent).toEqual({ offer_id: `SS-${sx}`, stock: 10, warehouse_id: 555 });
  });

  it("новая продажа на маркетплейсе списывается один раз; заказ самого сайта пропускается; потом в Ozon уходит новый остаток", async () => {
    const list = [posting("old", "delivered"), posting("new", "awaiting_packaging", 2), posting("site", "awaiting_packaging", 5, `SITE-${sx}`)];
    const fake = world(list);
    expect((await syncOzonStock(testOzon(fake), env)).writtenOff).toBe(1);
    expect(await stock()).toBe(8);
    expect(fake.bodies("/v2/products/stocks")[0].stocks.find((s: { offer_id: string }) => s.offer_id === `SS-${sx}`).stock).toBe(8);
    await syncOzonStock(testOzon(world(list)), env); // повтор — без второго списания
    expect(await stock()).toBe(8);
    const log = await prisma.stockChangeLog.findMany({ where: { productId: pid, source: "OZON_MARKETPLACE" } });
    expect(log).toHaveLength(1);
  });

  it("отмена списанного — возврат ровно один раз", async () => {
    const list = [posting("new", "cancelled", 2)];
    expect((await syncOzonStock(testOzon(world(list)), env)).returned).toBe(1);
    expect(await stock()).toBe(10);
    await syncOzonStock(testOzon(world(list)), env);
    expect(await stock()).toBe(10);
  });

  it("продажи не прочитались — в Ozon остаток не отправляем (иначе затрём проданное); без склада — ничего", async () => {
    const broken = fakeFetch({ "/v4/posting/fbs/list": () => ({ status: 500, body: {} }) });
    const r = await syncOzonStock(testOzon(broken), env);
    expect(r.errors[0]).toMatch(/продажи Ozon/);
    expect(broken.count("/v2/products/stocks")).toBe(0);
    const none = world([]);
    expect(await syncOzonStock(testOzon(none), {} as NodeJS.ProcessEnv)).toEqual({ writtenOff: 0, returned: 0, pushed: 0, errors: [] });
    expect(none.fetch).not.toHaveBeenCalled();
  });
});
