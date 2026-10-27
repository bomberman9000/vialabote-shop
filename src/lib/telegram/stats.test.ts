// @vitest-environment node
import { describe, it, expect } from "vitest";
import { computeStats, formatStats, periodRange, sparkline, startOfShopDay, type StatsOrder, type StatsProduct } from "./stats";

// 2026-10-27 15:00 по Москве = 12:00 UTC
const NOW = new Date("2026-10-27T12:00:00Z");
const at = (iso: string) => new Date(iso);
const item = (productId: string, quantity: number, price: number) => ({ productId, title: `T-${productId}`, quantity, price });
const order = (iso: string, status: string, items: ReturnType<typeof item>[]): StatsOrder => ({
  createdAt: at(iso),
  status,
  totalAmount: items.reduce((a, i) => a + i.quantity * i.price, 0),
  items,
});
const products: StatsProduct[] = [
  { id: "a", title: "A", stock: 3, status: "published" },
  { id: "b", title: "B", stock: 0, status: "published" },
  { id: "c", title: "C", stock: 10, status: "published" },
  { id: "d", title: "D", stock: 100, status: "published" },
  { id: "z", title: "Z", stock: 0, status: "archived" },
];
const labels = { money: (k: number) => `${k / 100}₽`, status: { PAID: "оплачен", NEW: "новый", CANCELLED: "отменён" }, statusOrder: ["NEW", "PAID", "CANCELLED"] };

describe("calendar (Moscow time)", () => {
  it("day starts at Moscow midnight", () => {
    expect(startOfShopDay(NOW).toISOString()).toBe("2026-10-26T21:00:00.000Z");
    expect(startOfShopDay(at("2026-10-26T21:30:00Z")).toISOString()).toBe("2026-10-26T21:00:00.000Z");
    expect(startOfShopDay(at("2026-10-26T20:59:00Z")).toISOString()).toBe("2026-10-25T21:00:00.000Z");
  });
  it("week/month include today", () => {
    expect(periodRange("week", NOW).from.toISOString()).toBe("2026-10-20T21:00:00.000Z");
    expect(periodRange("month", NOW).from.toISOString()).toBe("2026-09-27T21:00:00.000Z");
  });
});

describe("computeStats", () => {
  const orders: StatsOrder[] = [
    order("2026-10-27T06:00:00Z", "PAID", [item("c", 2, 1000)]), // сегодня 09:00 МСК
    order("2026-10-27T10:00:00Z", "COMPLETED", [item("a", 1, 5000), item("c", 1, 1000)]), // сегодня 13:00
    order("2026-10-27T11:00:00Z", "CANCELLED", [item("d", 5, 9999)]), // не выручка
    order("2026-10-27T11:30:00Z", "NEW", [item("d", 1, 9999)]), // не выручка
    order("2026-10-26T20:00:00Z", "PAID", [item("d", 1, 4000)]), // вчера 23:00 МСК
    order("2026-10-24T12:00:00Z", "SHIPPED", [item("a", 2, 5000)]),
    order("2026-10-10T12:00:00Z", "PAID", [item("c", 1, 1000)]), // вне недели, в месяце
  ];

  it("day: revenue only from paid-and-later orders, average check, statuses", () => {
    const r = computeStats(orders, products, "day", NOW);
    expect(r.revenue).toBe(2000 + 6000);
    expect(r.paidOrders).toBe(2);
    expect(r.ordersTotal).toBe(4);
    expect(r.avgCheck).toBe(4000);
    expect(r.statusCounts).toEqual({ PAID: 1, COMPLETED: 1, CANCELLED: 1, NEW: 1 });
    expect(r.prevRevenue).toBe(4000);
    expect(r.revenueChangePct).toBe(100);
    expect(r.buckets).toHaveLength(6);
    expect(r.buckets[2].revenue).toBe(2000); // 08–12
    expect(r.buckets[3].revenue).toBe(6000); // 12–16
    expect(r.buckets[3].orders).toBe(3); // 13:00, 14:00 (отменён), 14:30 (новый)
  });

  it("top products by revenue, cancelled orders excluded", () => {
    const r = computeStats(orders, products, "week", NOW);
    expect(r.topProducts.map((t) => t.productId)).toEqual(["a", "d", "c"]); // a 15000, d 4000, c 3000
    expect(r.topProducts[0]).toMatchObject({ units: 3, revenue: 15000 });
    expect(r.topProducts.find((t) => t.productId === "d")?.units).toBe(1);
  });

  it("week vs month windows", () => {
    expect(computeStats(orders, products, "week", NOW).revenue).toBe(2000 + 6000 + 4000 + 10000);
    expect(computeStats(orders, products, "month", NOW).revenue).toBe(2000 + 6000 + 4000 + 10000 + 1000);
    expect(computeStats(orders, products, "week", NOW).buckets).toHaveLength(7);
    expect(computeStats(orders, products, "month", NOW).buckets).toHaveLength(30);
  });

  it("stock and deficit: out, low, and fast sellers; archived ignored", () => {
    const r = computeStats(orders, products, "week", NOW);
    expect(r.stock).toEqual({ units: 113, activeProducts: 4, out: 1, low: 1 });
    expect(r.deficit.map((d) => [d.title, d.reason])).toEqual([
      ["B", "out"],
      ["A", "low"],
    ]);
    // C: 10 шт., продано 3 за ~6.6 дня -> хватит ~22 дня -> не дефицит; продадим быстрее:
    const fast = computeStats([...orders, order("2026-10-27T07:00:00Z", "PAID", [item("c", 20, 1000)])], products, "week", NOW);
    expect(fast.deficit.find((d) => d.title === "C")).toMatchObject({ reason: "fast", sold: 23 });
  });

  it("no orders: zeros, no division by zero", () => {
    const r = computeStats([], products, "month", NOW);
    expect(r).toMatchObject({ revenue: 0, avgCheck: 0, paidOrders: 0, revenueChangePct: null, topProducts: [] });
  });
});

describe("formatting", () => {
  it("sparkline", () => {
    expect(sparkline([0, 0])).toBe("▁▁");
    expect(sparkline([0, 5, 10])).toBe("▁▅█");
  });
  it("text contains every block and fits Telegram", () => {
    const r = computeStats([order("2026-10-27T06:00:00Z", "PAID", [item("a", 1, 5000)])], products, "week", NOW);
    const t = formatStats(r, labels);
    for (const s of ["Выручка: 50₽", "Средний чек: 50₽", "Топ товаров", "1. T-a — 1 шт.", "Статусы заказов: оплачен 1", "Остатки:", "Дефицит", "Динамика"]) {
      expect(t).toContain(s);
    }
    expect(t.length).toBeLessThan(4096);
  });
});
