// Telegram CMS V2 — read-only admin panel. Every screen here is a pure READ of Prisma:
// no create/update/delete/upsert, no transactions, no command layer. The route decides
// who may see a screen (ADMIN by Telegram user id, private chats only); this module only
// renders text + inline keyboards.
//
// Text is sent WITHOUT parse_mode, so product titles/customer cities need no escaping and
// cannot inject markup. Orders show number/date/status/total/city only — no phone, e-mail
// or street address in a chat. callback_data: "v2:<screen>:<page>" (≤ 64 bytes).
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/money";
import { ORDER_STATUSES } from "@/lib/constants";

export const PAGE_SIZE = 10;
export const LOW_STOCK = 5;
const MAX_TEXT = 3800; // Telegram limit is 4096 characters
const PLACEHOLDER_IMAGE = "/images/placeholder.svg";
const REVENUE_STATUSES = ["PAID", "PROCESSING", "SHIPPED", "COMPLETED"];

export type InlineKeyboard = { text: string; callback_data: string }[][];
export interface PanelScreen {
  text: string;
  keyboard: InlineKeyboard;
}

export const SCREENS = ["menu", "products", "stock", "orders", "inci", "problems", "stats", "settings"] as const;
export type ScreenId = (typeof SCREENS)[number];

const MENU_BUTTONS: { id: ScreenId; label: string }[] = [
  { id: "products", label: "📦 Товары" },
  { id: "orders", label: "🛒 Заказы" },
  { id: "inci", label: "🧪 Составы INCI" },
  { id: "stats", label: "📊 Статистика" },
  { id: "problems", label: "⚠️ Проблемы каталога" },
  { id: "settings", label: "⚙️ Настройки" },
];

const STATUS_RU: Record<string, string> = { draft: "черновик", published: "опубликован", archived: "архив" };
const ORDER_STATUS_RU: Record<string, string> = {
  NEW: "новый",
  AWAITING_PAYMENT: "ждёт оплаты",
  PAID: "оплачен",
  PROCESSING: "в работе",
  SHIPPED: "отправлен",
  COMPLETED: "выполнен",
  CANCELLED: "отменён",
};

export function cb(screen: ScreenId, page = 0): string {
  return `v2:${screen}:${page}`;
}

/** "v2:orders:2" -> { screen: "orders", page: 2 }; anything else -> null. */
export function parseCallback(data: string): { screen: ScreenId; page: number } | null {
  const m = /^v2:([a-z]+):(\d{1,4})$/.exec(data);
  if (!m || !(SCREENS as readonly string[]).includes(m[1])) return null;
  return { screen: m[1] as ScreenId, page: Number(m[2]) };
}

/** /start, /help, /menu (optionally /start@botname) and the word "меню". */
export function isMenuCommand(text: string): "start" | "help" | null {
  const t = text.trim().toLowerCase();
  const m = /^\/(start|help|menu)(?:@[a-z0-9_]{3,64})?(?:\s.*)?$/.exec(t);
  if (m) return m[1] === "help" ? "help" : "start";
  if (t === "меню") return "start";
  if (t === "помощь") return "help";
  return null;
}

function clip(text: string): string {
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT - 40)}\n…\n(список сокращён)`;
}

function backRow(): { text: string; callback_data: string }[] {
  return [{ text: "⬅️ Меню", callback_data: cb("menu") }];
}

function pager(screen: ScreenId, page: number, total: number): InlineKeyboard {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const row: { text: string; callback_data: string }[] = [];
  if (page > 0) row.push({ text: "◀️", callback_data: cb(screen, page - 1) });
  row.push({ text: `${Math.min(page + 1, pages)}/${pages}`, callback_data: cb(screen, page) });
  if (page + 1 < pages) row.push({ text: "▶️", callback_data: cb(screen, page + 1) });
  return [row, backRow()];
}

function clampPage(page: number, total: number): number {
  const last = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  return Math.min(Math.max(0, page), last);
}

function date(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function menuScreen(): PanelScreen {
  const rows: InlineKeyboard = [];
  for (let i = 0; i < MENU_BUTTONS.length; i += 2) {
    rows.push(MENU_BUTTONS.slice(i, i + 2).map((b) => ({ text: b.label, callback_data: cb(b.id) })));
  }
  rows.push([{ text: "📉 Остатки", callback_data: cb("stock") }]);
  return { text: "VIA LABOTE — панель магазина (только просмотр).\nВыберите раздел:", keyboard: rows };
}

export function helpText(): string {
  return [
    "VIA LABOTE — Telegram-панель магазина. Режим: только просмотр.",
    "",
    "Команды:",
    "/start или /menu — главное меню",
    "/help — эта справка",
    "«показать товары без INCI» — список товаров без состава",
    "",
    "Разделы меню: товары и статусы, остатки, заказы, составы INCI, проблемы каталога, статистика, настройки.",
    "Изменить цены, товары, заказы, остатки или настройки через Telegram нельзя — используйте Web Admin.",
  ].join("\n");
}

async function productsScreen(page: number): Promise<PanelScreen> {
  const total = await prisma.product.count();
  page = clampPage(page, total);
  const rows = await prisma.product.findMany({
    select: { title: true, status: true, price: true, stock: true },
    orderBy: [{ status: "asc" }, { title: "asc" }],
    skip: page * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  const byStatus = await prisma.product.groupBy({ by: ["status"], _count: { _all: true } });
  const summary = byStatus.map((s) => `${STATUS_RU[s.status] ?? s.status}: ${s._count._all}`).join(", ");
  const lines = rows.map(
    (p, i) => `${page * PAGE_SIZE + i + 1}. ${p.title} — ${STATUS_RU[p.status] ?? p.status}, ${formatPrice(p.price)}, остаток ${p.stock}`,
  );
  return {
    text: clip([`📦 Товары (${total}; ${summary || "нет"})`, "", ...(lines.length ? lines : ["Товаров нет."])].join("\n")),
    keyboard: pager("products", page, total),
  };
}

async function stockScreen(page: number): Promise<PanelScreen> {
  const where = { status: { not: "archived" } };
  const total = await prisma.product.count({ where });
  page = clampPage(page, total);
  const rows = await prisma.product.findMany({
    where,
    select: { title: true, stock: true, status: true },
    orderBy: [{ stock: "asc" }, { title: "asc" }],
    skip: page * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  const out = await prisma.product.count({ where: { ...where, stock: { lte: 0 } } });
  const low = await prisma.product.count({ where: { ...where, stock: { gt: 0, lt: LOW_STOCK } } });
  const units = await prisma.product.aggregate({ where, _sum: { stock: true } });
  const lines = rows.map((p) => `${p.stock <= 0 ? "⛔" : p.stock < LOW_STOCK ? "🟡" : "🟢"} ${p.title}: ${p.stock} шт.`);
  return {
    text: clip(
      [
        `📉 Остатки (активные товары: ${total}, всего единиц: ${units._sum.stock ?? 0})`,
        `нет в наличии: ${out}, мало (<${LOW_STOCK}): ${low}`,
        "",
        ...(lines.length ? lines : ["Товаров нет."]),
      ].join("\n"),
    ),
    keyboard: pager("stock", page, total),
  };
}

async function ordersScreen(page: number): Promise<PanelScreen> {
  const total = await prisma.order.count();
  page = clampPage(page, total);
  const rows = await prisma.order.findMany({
    select: { number: true, status: true, totalAmount: true, createdAt: true, deliveryCity: true, _count: { select: { items: true } } },
    orderBy: { createdAt: "desc" },
    skip: page * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  const lines = rows.map(
    (o) =>
      `№${o.number} · ${date(o.createdAt)} · ${ORDER_STATUS_RU[o.status] ?? o.status} · ${formatPrice(o.totalAmount)} · позиций ${o._count.items} · ${o.deliveryCity}`,
  );
  return {
    text: clip([`🛒 Заказы (${total}), новые сверху`, "", ...(lines.length ? lines : ["Заказов пока нет."])].join("\n")),
    keyboard: pager("orders", page, total),
  };
}

export async function inciMissingText(): Promise<string> {
  // same query as the existing text command (activeIngredients is the INCI field)
  const products = await prisma.product.findMany({
    where: { activeIngredients: null, status: { not: "archived" } },
    select: { title: true, slug: true },
    orderBy: { title: "asc" },
  });
  return products.length === 0
    ? "Все активные товары содержат состав (INCI)."
    : `Товары без состава (INCI):\n${products.map((p) => `• ${p.title} (${p.slug})`).join("\n")}`;
}

async function inciScreen(): Promise<PanelScreen> {
  const active = await prisma.product.count({ where: { status: { not: "archived" } } });
  const missing = await prisma.product.count({ where: { status: { not: "archived" }, activeIngredients: null } });
  return {
    text: clip(`🧪 Составы INCI — заполнено ${active - missing} из ${active}\n\n${await inciMissingText()}`),
    keyboard: [backRow()],
  };
}

export interface CatalogProblem {
  title: string;
  issues: string[];
}

export async function catalogProblems(): Promise<CatalogProblem[]> {
  const rows = await prisma.product.findMany({
    where: { status: { not: "archived" } },
    select: {
      title: true,
      status: true,
      price: true,
      oldPrice: true,
      stock: true,
      imageUrl: true,
      description: true,
      activeIngredients: true,
      media: { where: { validationState: "valid" }, select: { id: true } },
    },
    orderBy: { title: "asc" },
  });
  const out: CatalogProblem[] = [];
  for (const p of rows) {
    const issues: string[] = [];
    if (p.price <= 0) issues.push("цена не задана");
    if (p.oldPrice != null && p.oldPrice <= p.price) issues.push("старая цена не больше текущей");
    if (!p.activeIngredients?.trim()) issues.push("нет состава INCI");
    if (!p.description.trim()) issues.push("нет описания");
    if ((!p.imageUrl || p.imageUrl === PLACEHOLDER_IMAGE) && p.media.length === 0) issues.push("нет фото");
    if (p.status === "published" && p.stock <= 0) issues.push("опубликован, но нет в наличии");
    if (issues.length) out.push({ title: p.title, issues });
  }
  return out;
}

async function problemsScreen(page: number): Promise<PanelScreen> {
  const all = await catalogProblems();
  page = clampPage(page, all.length);
  const slice = all.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const lines = slice.map((p) => `• ${p.title}: ${p.issues.join("; ")}`);
  return {
    text: clip(
      [`⚠️ Проблемы каталога (товаров с проблемами: ${all.length})`, "", ...(lines.length ? lines : ["Проблем не найдено ✅"])].join("\n"),
    ),
    keyboard: pager("problems", page, all.length),
  };
}

async function statsScreen(now: Date): Promise<PanelScreen> {
  const since = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const [byStatus, orderByStatus, revenueAll, revenue30, orders7, orders30, customers, stockUnits] = await Promise.all([
    prisma.product.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.order.aggregate({ where: { status: { in: REVENUE_STATUSES } }, _sum: { totalAmount: true }, _count: { _all: true } }),
    prisma.order.aggregate({ where: { status: { in: REVENUE_STATUSES }, createdAt: { gte: since(30) } }, _sum: { totalAmount: true }, _count: { _all: true } }),
    prisma.order.count({ where: { createdAt: { gte: since(7) } } }),
    prisma.order.count({ where: { createdAt: { gte: since(30) } } }),
    prisma.user.count({ where: { role: "CUSTOMER" } }),
    prisma.product.aggregate({ where: { status: { not: "archived" } }, _sum: { stock: true } }),
  ]);
  const productLine = byStatus.map((s) => `${STATUS_RU[s.status] ?? s.status} ${s._count._all}`).join(", ") || "нет";
  const orderCounts = new Map(orderByStatus.map((s) => [s.status, s._count._all]));
  const orderLine = ORDER_STATUSES.filter((s) => orderCounts.get(s)).map((s) => `${ORDER_STATUS_RU[s]} ${orderCounts.get(s)}`).join(", ") || "нет";
  const paidCount = revenueAll._count._all;
  const avg = paidCount ? Math.round((revenueAll._sum.totalAmount ?? 0) / paidCount) : 0;
  return {
    text: [
      "📊 Статистика",
      "",
      `Товары: ${productLine}`,
      `Единиц на складе (активные): ${stockUnits._sum.stock ?? 0}`,
      `Заказы: ${orderLine}`,
      `Заказов за 7 дней: ${orders7}, за 30 дней: ${orders30}`,
      `Выручка (оплаченные и далее): ${formatPrice(revenueAll._sum.totalAmount ?? 0)} в ${paidCount} заказах`,
      `Выручка за 30 дней: ${formatPrice(revenue30._sum.totalAmount ?? 0)} в ${revenue30._count._all} заказах`,
      `Средний чек: ${formatPrice(avg)}`,
      `Покупателей с аккаунтом: ${customers}`,
    ].join("\n"),
    keyboard: [backRow()],
  };
}

function releaseCommit(): string {
  try {
    return fs.readFileSync(path.join(process.cwd(), ".release-commit"), "utf8").trim().slice(0, 7) || "—";
  } catch {
    return "—";
  }
}

async function settingsScreen(): Promise<PanelScreen> {
  const linkedAdmins = await prisma.user.count({ where: { role: "ADMIN", telegramUserId: { not: null } } });
  return {
    text: [
      "⚙️ Настройки (только просмотр)",
      "",
      "Режим Telegram-панели: только чтение",
      "Изменение цен, товаров, заказов, остатков и настроек через Telegram: запрещено в коде",
      "Доступ: только ADMIN, по числовому Telegram ID, только в личном чате",
      `Администраторов с привязанным Telegram: ${linkedAdmins}`,
      `Релиз сайта: ${releaseCommit()}`,
      "Изменения — через Web Admin.",
    ].join("\n"),
    keyboard: [backRow()],
  };
}

/** Render a screen. Read-only by construction: only findMany/count/aggregate/groupBy. */
export async function renderScreen(screen: ScreenId, page = 0, now = new Date()): Promise<PanelScreen> {
  switch (screen) {
    case "menu":
      return menuScreen();
    case "products":
      return productsScreen(page);
    case "stock":
      return stockScreen(page);
    case "orders":
      return ordersScreen(page);
    case "inci":
      return inciScreen();
    case "problems":
      return problemsScreen(page);
    case "stats":
      return statsScreen(now);
    case "settings":
      return settingsScreen();
  }
}
