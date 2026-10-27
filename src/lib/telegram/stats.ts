// Статистика магазина для Telegram-панели. ВСЁ здесь — чистые функции над уже загруженными
// строками (без Prisma, без Date.now()): тестируются без БД. Загрузка строк — в panel.ts.
//
// Деньги — в копейках (как Product.price/Order.totalAmount). Выручка = заказы в статусах
// REVENUE_STATUSES (оплачены и дальше); отменённые и неоплаченные в неё не входят.
// Календарь — по московскому времени (UTC+3, без перехода на летнее): магазин российский,
// «сегодня» для владельца — это московские сутки.

export const REVENUE_STATUSES = ["PAID", "PROCESSING", "SHIPPED", "COMPLETED"] as const;
export const LOW_STOCK_THRESHOLD = 5;
/** Товар «в дефиците», если при текущем темпе продаж остатка хватит меньше чем на столько дней. */
export const DEFICIT_COVER_DAYS = 7;
export const SHOP_TZ_OFFSET_MIN = 180;
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export const PERIODS = ["day", "week", "month"] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABEL: Record<Period, string> = { day: "день", week: "неделя", month: "месяц" };

export function isPeriod(v: string): v is Period {
  return (PERIODS as readonly string[]).includes(v);
}

export interface StatsOrderItem {
  productId: string;
  title: string;
  quantity: number;
  price: number;
}
export interface StatsOrder {
  createdAt: Date;
  status: string;
  totalAmount: number;
  items: StatsOrderItem[];
}
export interface StatsProduct {
  id: string;
  title: string;
  stock: number;
  status: string;
}

export interface Bucket {
  label: string;
  revenue: number;
  orders: number;
}
export interface TopProduct {
  productId: string;
  title: string;
  units: number;
  revenue: number;
}
export interface DeficitItem {
  title: string;
  stock: number;
  /** продано за период (шт.) */
  sold: number;
  /** на сколько дней хватит остатка при темпе периода; null — продаж не было */
  coverDays: number | null;
  reason: "out" | "low" | "fast";
}
export interface StatsReport {
  period: Period;
  from: Date;
  to: Date;
  revenue: number;
  prevRevenue: number;
  /** изменение выручки к предыдущему такому же периоду, %; null если сравнивать не с чем */
  revenueChangePct: number | null;
  ordersTotal: number;
  paidOrders: number;
  avgCheck: number;
  topProducts: TopProduct[];
  buckets: Bucket[];
  statusCounts: Record<string, number>;
  stock: { units: number; activeProducts: number; out: number; low: number };
  deficit: DeficitItem[];
}

/** Начало московских суток для момента t. */
export function startOfShopDay(t: Date): Date {
  const shifted = t.getTime() + SHOP_TZ_OFFSET_MIN * MIN;
  return new Date(Math.floor(shifted / DAY) * DAY - SHOP_TZ_OFFSET_MIN * MIN);
}

/**
 * Границы периода: day = с начала московских суток до now; week/month = последние 7/30 суток,
 * выровненные на московскую полночь (включая сегодняшний неполный день).
 */
export function periodRange(period: Period, now: Date): { from: Date; to: Date; days: number } {
  const today = startOfShopDay(now);
  const days = period === "day" ? 1 : period === "week" ? 7 : 30;
  return { from: new Date(today.getTime() - (days - 1) * DAY), to: now, days };
}

const isRevenue = (status: string) => (REVENUE_STATUSES as readonly string[]).includes(status);

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function shopHour(t: Date): number {
  return new Date(t.getTime() + SHOP_TZ_OFFSET_MIN * MIN).getUTCHours();
}
function shopDayLabel(t: Date): string {
  const d = new Date(t.getTime() + SHOP_TZ_OFFSET_MIN * MIN);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}`;
}

function buildBuckets(period: Period, from: Date, orders: StatsOrder[]): Bucket[] {
  const revenueOrders = orders.filter((o) => isRevenue(o.status));
  if (period === "day") {
    // 6 корзин по 4 часа московских суток
    return Array.from({ length: 6 }, (_, i) => {
      const inBucket = (o: StatsOrder) => Math.floor(shopHour(o.createdAt) / 4) === i;
      const mine = revenueOrders.filter(inBucket);
      return { label: `${pad(i * 4)}–${pad(i * 4 + 4)}ч`, revenue: sum(mine.map((o) => o.totalAmount)), orders: orders.filter(inBucket).length };
    });
  }
  const days = period === "week" ? 7 : 30;
  return Array.from({ length: days }, (_, i) => {
    const start = from.getTime() + i * DAY;
    const inBucket = (o: StatsOrder) => o.createdAt.getTime() >= start && o.createdAt.getTime() < start + DAY;
    const mine = revenueOrders.filter(inBucket);
    return { label: shopDayLabel(new Date(start)), revenue: sum(mine.map((o) => o.totalAmount)), orders: orders.filter(inBucket).length };
  });
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * orders — заказы за [prevFrom, now] (текущий + предыдущий такой же период); считаем сами.
 * products — все товары (для остатков и дефицита).
 */
export function computeStats(orders: StatsOrder[], products: StatsProduct[], period: Period, now: Date): StatsReport {
  const { from, to, days } = periodRange(period, now);
  const prevFrom = new Date(from.getTime() - days * DAY);
  const inPeriod = orders.filter((o) => o.createdAt >= from && o.createdAt <= to);
  const inPrev = orders.filter((o) => o.createdAt >= prevFrom && o.createdAt < from);

  const paid = inPeriod.filter((o) => isRevenue(o.status));
  const revenue = sum(paid.map((o) => o.totalAmount));
  const prevRevenue = sum(inPrev.filter((o) => isRevenue(o.status)).map((o) => o.totalAmount));

  const statusCounts: Record<string, number> = {};
  for (const o of inPeriod) statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1;

  const byProduct = new Map<string, TopProduct>();
  for (const o of paid) {
    for (const it of o.items) {
      const cur = byProduct.get(it.productId) ?? { productId: it.productId, title: it.title, units: 0, revenue: 0 };
      cur.units += it.quantity;
      cur.revenue += it.quantity * it.price;
      byProduct.set(it.productId, cur);
    }
  }
  const topProducts = Array.from(byProduct.values())
    .sort((a, b) => b.revenue - a.revenue || b.units - a.units || a.title.localeCompare(b.title, "ru"))
    .slice(0, 5);

  const active = products.filter((p) => p.status !== "archived");
  const out = active.filter((p) => p.stock <= 0).length;
  const low = active.filter((p) => p.stock > 0 && p.stock < LOW_STOCK_THRESHOLD).length;

  // Темп продаж считаем по фактически прошедшему времени периода (сегодня — не 24 ч, а сколько прошло),
  // но не короче часа, чтобы не делить на ноль в первую минуту суток.
  const elapsedDays = Math.max((to.getTime() - from.getTime()) / DAY, HOUR / DAY);
  const deficit: DeficitItem[] = [];
  for (const p of active) {
    const sold = byProduct.get(p.id)?.units ?? 0;
    const coverDays = sold > 0 ? p.stock / (sold / elapsedDays) : null;
    if (p.stock <= 0) deficit.push({ title: p.title, stock: p.stock, sold, coverDays: sold > 0 ? 0 : null, reason: "out" });
    else if (p.stock < LOW_STOCK_THRESHOLD) deficit.push({ title: p.title, stock: p.stock, sold, coverDays, reason: "low" });
    else if (coverDays !== null && coverDays < DEFICIT_COVER_DAYS) deficit.push({ title: p.title, stock: p.stock, sold, coverDays, reason: "fast" });
  }
  const rank = { out: 0, low: 1, fast: 2 } as const;
  deficit.sort((a, b) => rank[a.reason] - rank[b.reason] || a.stock - b.stock || a.title.localeCompare(b.title, "ru"));

  return {
    period,
    from,
    to,
    revenue,
    prevRevenue,
    revenueChangePct: prevRevenue > 0 ? Math.round(((revenue - prevRevenue) / prevRevenue) * 100) : null,
    ordersTotal: inPeriod.length,
    paidOrders: paid.length,
    avgCheck: paid.length ? Math.round(revenue / paid.length) : 0,
    topProducts,
    buckets: buildBuckets(period, from, inPeriod),
    statusCounts,
    stock: { units: sum(active.map((p) => Math.max(0, p.stock))), activeProducts: active.length, out, low },
    deficit,
  };
}

const SPARK = "▁▂▃▄▅▆▇█";
/** Мини-график: самая высокая корзина = █, нулевая = ▁. */
export function sparkline(values: number[]): string {
  const max = Math.max(0, ...values);
  if (max <= 0) return SPARK[0].repeat(values.length);
  return values.map((v) => SPARK[Math.min(SPARK.length - 1, Math.round((v / max) * (SPARK.length - 1)))]).join("");
}

export interface StatsLabels {
  money: (kopecks: number) => string;
  status: Record<string, string>;
  statusOrder: readonly string[];
}

export function formatStats(r: StatsReport, L: StatsLabels): string {
  const lines: string[] = [];
  lines.push(`📊 Статистика — ${PERIOD_LABEL[r.period]}`);
  lines.push(`${shopDayLabel(r.from)} – ${shopDayLabel(r.to)} (по Москве)`);
  lines.push("");
  const change = r.revenueChangePct === null ? "" : ` (${r.revenueChangePct >= 0 ? "+" : ""}${r.revenueChangePct}% к прошлому периоду)`;
  lines.push(`💰 Выручка: ${L.money(r.revenue)}${change}`);
  lines.push(`🧾 Заказов: ${r.ordersTotal}, оплаченных: ${r.paidOrders}`);
  lines.push(`💳 Средний чек: ${L.money(r.avgCheck)}`);
  lines.push("");
  lines.push(`Динамика выручки: ${sparkline(r.buckets.map((b) => b.revenue))}`);
  if (r.period === "day") lines.push(r.buckets.map((b) => `${b.label} ${b.orders}`).join(" · ") + "  (заказов)");
  else {
    const best = r.buckets.reduce((a, b) => (b.revenue > a.revenue ? b : a), r.buckets[0]);
    if (best && best.revenue > 0) lines.push(`Лучший день: ${best.label} — ${L.money(best.revenue)}, заказов ${best.orders}`);
  }
  lines.push("");
  lines.push("🏆 Топ товаров:");
  if (r.topProducts.length === 0) lines.push("— продаж за период нет");
  r.topProducts.forEach((t, i) => lines.push(`${i + 1}. ${t.title} — ${t.units} шт., ${L.money(t.revenue)}`));
  lines.push("");
  const statuses = L.statusOrder.filter((s) => r.statusCounts[s]).map((s) => `${L.status[s] ?? s} ${r.statusCounts[s]}`);
  lines.push(`📋 Статусы заказов: ${statuses.join(", ") || "заказов нет"}`);
  lines.push("");
  lines.push(`📦 Остатки: ${r.stock.units} шт. в ${r.stock.activeProducts} активных товарах; нет в наличии ${r.stock.out}, мало (<${LOW_STOCK_THRESHOLD}) ${r.stock.low}`);
  if (r.deficit.length) {
    lines.push("⚠️ Дефицит:");
    for (const d of r.deficit.slice(0, 8)) {
      const why = d.reason === "out" ? "нет в наличии" : d.reason === "low" ? `осталось ${d.stock}` : `осталось ${d.stock}, хватит на ~${Math.max(1, Math.floor(d.coverDays ?? 0))} дн.`;
      lines.push(`• ${d.title}: ${why}${d.sold ? `, продано ${d.sold}` : ""}`);
    }
    if (r.deficit.length > 8) lines.push(`… и ещё ${r.deficit.length - 8}`);
  } else lines.push("Дефицита нет ✅");
  return lines.join("\n");
}
