// Ozon Доставка для витрины: ПВЗ, карта, доступность, расчёт цены и срока для корзины, остатки FBS.
// Клиент и токен собираются из env один раз на процесс; без OZON_APP_* всё здесь возвращает null/disabled.
import { prisma } from "@/lib/prisma";
import {
  createOzonClient,
  normalizeRuPhone,
  OzonError,
  ozonConfig,
  summarizeCheckout,
  type ChosenSplit,
  type DeliveryPointInfo,
  type LatLong,
  type OzonClient,
  type OzonConfig,
  type Viewport,
} from "./ozon";
import { createTokenStore } from "./ozon-token";
import { matchesAddress } from "./address-match";

export interface Ozon {
  cfg: OzonConfig;
  client: OzonClient;
  exchangeCode: (code: string) => Promise<{ expiresIn: number; scope: string | null }>;
}

let instance: { key: string; ozon: Ozon } | null = null;

/**
 * Боевой Ozon для заказов, которые уже есть (довести после оплаты, опрос статусов, админка): только OZON_ENV=prod.
 * Песочница сюда не попадает никогда — настоящие оплаченные заказы не уйдут в тестовую среду.
 */
export function getProdOzon(env: NodeJS.ProcessEnv = process.env): Ozon | null {
  const ozon = getOzon(env);
  return ozon?.cfg.env === "prod" ? ozon : null;
}

/**
 * Ozon на витрине (выбор ПВЗ, расчёт, оформление): боевой и явно включён OZON_CHECKOUT_ENABLED=1.
 * Без флага ключи можно положить и проверить скриптами — покупатели ничего не увидят.
 */
export function getCheckoutOzon(env: NodeJS.ProcessEnv = process.env): Ozon | null {
  return env.OZON_CHECKOUT_ENABLED?.trim() === "1" ? getProdOzon(env) : null;
}

/** Любой настроенный Ozon, в том числе песочница: для скриптов (check, oauth, sandbox-e2e). null — нет ключей. */
export function getOzon(env: NodeJS.ProcessEnv = process.env): Ozon | null {
  const cfg = ozonConfig(env);
  if (!cfg) return null;
  const key = JSON.stringify(cfg);
  if (instance?.key === key) return instance.ozon;
  const tokens = createTokenStore(cfg, { prisma });
  const ozon: Ozon = {
    cfg,
    client: createOzonClient(cfg, { getAccessToken: (force) => tokens.getAccessToken(force) }),
    exchangeCode: (code) => tokens.exchangeCode(code),
  };
  instance = { key, ozon };
  clearOzonCache();
  return ozon;
}

// ---------------------------------------------------------------- кеш

const cache = new Map<string, { expires: number; value: Promise<unknown> }>();

/** Кеш в памяти процесса. Хранится промис: одновременные одинаковые запросы идут в Ozon один раз; ошибка не кешируется. */
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { expires: Date.now() + ttlMs, value });
  value.catch(() => cache.delete(key));
  if (cache.size > 2000) for (const [k, v] of cache) if (v.expires <= Date.now()) cache.delete(k);
  return value;
}

export function clearOzonCache() {
  cache.clear();
}

const POINTS_TTL = 6 * 60 * 60_000;
const INFO_TTL = 60 * 60_000;
const MAP_TTL = 10 * 60_000;
const STOCK_TTL = 60_000;

// ---------------------------------------------------------------- точки самовывоза

export interface PickupPoint {
  id: string;
  lat: number;
  long: number;
}

async function allPoints(ozon: Ozon): Promise<PickupPoint[]> {
  return cached("points", POINTS_TTL, async () => {
    const res = await ozon.client.deliveryPointList();
    return (res.points ?? [])
      .filter((p) => p.map_point_id && Number.isFinite(p.coordinate?.lat) && Number.isFinite(p.coordinate?.long))
      .map((p) => ({ id: String(p.map_point_id), lat: p.coordinate!.lat, long: p.coordinate!.long }));
  });
}

/** Расстояние по сфере, км. */
export function distanceKm(a: LatLong, b: LatLong): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLong = (b.long - a.long) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLong / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Ближайшие к точке ПВЗ (из полного списка Ozon, он кешируется на 6 ч). */
export async function nearestPoints(ozon: Ozon, at: LatLong, limit = 20) {
  const points = await allPoints(ozon);
  return points
    .map((p) => ({ ...p, distanceKm: Math.round(distanceKm(at, p) * 10) / 10 }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, Math.min(Math.max(limit, 1), 50));
}

export async function pointsInViewport(ozon: Ozon, v: Viewport, limit = 200) {
  const points = await allPoints(ozon);
  return points
    .filter((p) => p.lat >= v.left_bottom.lat && p.lat <= v.right_top.lat && p.long >= v.left_bottom.long && p.long <= v.right_top.long)
    .slice(0, Math.min(Math.max(limit, 1), 500));
}

export interface PickupPointCard {
  id: string;
  enabled: boolean;
  name: string | null;
  address: string | null;
  city: string | null;
  lat: number | null;
  long: number | null;
  type: string | null;
  storageDays: number | null;
  description: string | null;
}

function toCard(p: DeliveryPointInfo): PickupPointCard | null {
  const m = p.delivery_method;
  if (!m?.map_point_id) return null;
  return {
    id: String(m.map_point_id),
    enabled: p.enabled !== false,
    name: m.name ?? null,
    address: m.address ?? null,
    city: m.address_details?.city ?? null,
    lat: m.coordinates?.lat ?? null,
    long: m.coordinates?.long ?? null,
    type: m.delivery_type?.name ?? null,
    storageDays: typeof m.storage_period === "number" ? m.storage_period : null,
    description: m.description ?? null,
  };
}

/** Карточки ПВЗ; каждая кешируется на час отдельно, в Ozon уходят только недостающие (до 100 за запрос). */
export async function pointCards(ozon: Ozon, ids: string[]): Promise<PickupPointCard[]> {
  const unique = [...new Set(ids.filter((id) => /^\d{1,19}$/.test(id)))].slice(0, 100);
  const missing = unique.filter((id) => !cache.has(`point:${id}`) || cache.get(`point:${id}`)!.expires <= Date.now());
  if (missing.length) {
    const batch = ozon.client.deliveryPointInfo(missing).then((r) => {
      const byId = new Map<string, PickupPointCard>();
      for (const p of r.points ?? []) {
        const card = toCard(p);
        if (card) byId.set(card.id, card);
      }
      return byId;
    });
    for (const id of missing) {
      void cached(`point:${id}`, INFO_TTL, () => batch.then((m) => m.get(id) ?? null));
    }
  }
  const cards = await Promise.all(unique.map((id) => cached<PickupPointCard | null>(`point:${id}`, INFO_TTL, async () => null)));
  return cards.filter((c): c is PickupPointCard => c !== null);
}

/** Где искать пункты по улице: ближайшие к центру города, не дальше радиуса. Холодный поиск — до 10 запросов point/info. */
const STREET_SCAN = 1000;
const STREET_RADIUS_KM = 40;

/**
 * Пункты на улице (и доме) из запроса — среди ближайших к центру города. Адреса берутся из карточек пунктов
 * (кеш 1 ч на карточку), поэтому повторный поиск в том же городе в Ozon не ходит.
 */
export async function pointsOnStreet(ozon: Ozon, at: LatLong, query: string, limit = 50) {
  const near = (await allPoints(ozon))
    .map((p) => ({ id: p.id, km: distanceKm(at, p) }))
    .filter((p) => p.km <= STREET_RADIUS_KM)
    .sort((a, b) => a.km - b.km)
    .slice(0, STREET_SCAN);
  const km = new Map(near.map((p) => [p.id, Math.round(p.km * 10) / 10]));
  const chunks: string[][] = [];
  for (let i = 0; i < near.length; i += 100) chunks.push(near.slice(i, i + 100).map((p) => p.id));
  const cards = (await Promise.all(chunks.map((ids) => pointCards(ozon, ids)))).flat();
  return cards
    .filter((c) => c.enabled && c.address && matchesAddress(c.address, query))
    .map((c) => ({ ...c, distanceKm: km.get(c.id) ?? null }))
    .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
    .slice(0, limit);
}

/** Кластеры ПВЗ для карты. Ключ кеша — область, округлённая до ~1 км, и масштаб. */
export async function mapClusters(ozon: Ozon, v: Viewport, zoom: number) {
  const r = (x: number) => Math.round(x * 100) / 100;
  const viewport = {
    left_bottom: { lat: r(v.left_bottom.lat), long: r(v.left_bottom.long) },
    right_top: { lat: r(v.right_top.lat), long: r(v.right_top.long) },
  };
  const z = Math.min(Math.max(Math.round(zoom), 1), 21);
  return cached(`map:${JSON.stringify(viewport)}:${z}`, MAP_TTL, async () => {
    const res = await ozon.client.deliveryMap(viewport, z);
    return (res.clusters ?? []).map((c) => ({
      lat: c.coordinate?.lat ?? null,
      long: c.coordinate?.long ?? null,
      count: c.points_count ?? c.map_point_ids?.length ?? 0,
      pointIds: (c.map_point_ids ?? []).map(String),
      sameBuilding: Boolean(c.is_same_building),
      viewport: c.viewport ?? null,
    }));
  });
}

/** Есть ли доставка Ozon для покупателя (по телефону). Не учитывает сумму, категории и географию — см. квоту. */
export async function checkBuyer(ozon: Ozon, phone: string): Promise<{ possible: boolean }> {
  const p = normalizeRuPhone(phone);
  if (!p) return { possible: false };
  const r = await ozon.client.deliveryCheck(p);
  return { possible: r.is_possible === true };
}

// ---------------------------------------------------------------- остатки FBS

/** Доступно на FBS-складах Ozon по offer_id: present − reserved. Сбой Ozon -> null (решает checkout). */
export async function fbsAvailable(ozon: Ozon, offerIds: string[]): Promise<Map<string, number> | null> {
  const ids = [...new Set(offerIds)].sort();
  if (ids.length === 0) return new Map();
  try {
    return await cached(`stocks:${ids.join(",")}`, STOCK_TTL, async () => {
      const res = await ozon.client.productStocks(ids);
      const out = new Map<string, number>(ids.map((id) => [id, 0]));
      for (const item of res.items ?? []) {
        if (!item.offer_id) continue;
        const fbs = (item.stocks ?? []).filter((s) => s.type === "fbs");
        out.set(item.offer_id, fbs.reduce((sum, s) => sum + Math.max(0, (s.present ?? 0) - (s.reserved ?? 0)), 0));
      }
      return out;
    });
  } catch (err) {
    console.error("ozon: остатки FBS не получены", err instanceof OzonError ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------- расчёт для корзины

export type OzonDestination =
  | { type: "PVZ"; mapPointId: string }
  | { type: "COURIER"; latitude: number; longitude: number };

export interface CartLine {
  productId: string;
  quantity: number;
}

export type CartQuote =
  | {
      available: true;
      deliveryType: "PVZ" | "COURIER";
      priceKopecks: number;
      /** крайний срок получения (ISO, UTC) — показывается покупателю обязательно */
      maxDate: string;
      splits: ChosenSplit[];
    }
  | { available: false; reason: string; productIds?: string[] };

/** Сопоставление позиций корзины с карточками Ozon. Товар без ozonSku Ozon не доставляет. */
export async function mapCart(lines: CartLine[]) {
  const wanted = new Map<string, number>();
  for (const l of lines) wanted.set(l.productId, (wanted.get(l.productId) ?? 0) + l.quantity);
  const products = await prisma.product.findMany({
    where: { id: { in: [...wanted.keys()] } },
    select: { id: true, title: true, ozonSku: true, ozonOfferId: true },
  });
  const notMapped = [...wanted.keys()].filter((id) => {
    const p = products.find((x) => x.id === id);
    return !p?.ozonSku || !/^\d{1,16}$/.test(p.ozonSku) || !Number.isSafeInteger(Number(p.ozonSku));
  });
  const items = products
    .filter((p) => !notMapped.includes(p.id))
    .map((p) => ({ productId: p.id, sku: Number(p.ozonSku), offerId: p.ozonOfferId ?? undefined, quantity: wanted.get(p.id)! }));
  return { items, notMapped };
}

/**
 * Цена и максимальный срок доставки корзины. Считается ТОЛЬКО на сервере: сумма заказа включает доставку
 * и сверяется с банком, поэтому цену от клиента не берём.
 */
export async function quoteCart(
  ozon: Ozon,
  { lines, destination, phone }: { lines: CartLine[]; destination: OzonDestination; phone?: string },
): Promise<CartQuote> {
  const { items, notMapped } = await mapCart(lines);
  if (notMapped.length) return { available: false, reason: "NOT_MAPPED", productIds: notMapped };
  if (items.length === 0) return { available: false, reason: "EMPTY" };

  const withOffer = items.filter((i) => i.offerId);
  const stock = await fbsAvailable(ozon, withOffer.map((i) => i.offerId!));
  if (stock) {
    const short = withOffer.filter((i) => (stock.get(i.offerId!) ?? 0) < i.quantity).map((i) => i.productId);
    if (short.length) return { available: false, reason: "OUT_OF_STOCK_FBS", productIds: short };
  }

  const buyerPhone = phone ? normalizeRuPhone(phone) : null;
  const res = await ozon.client.deliveryCheckout({
    ...(buyerPhone ? { buyer_phone: buyerPhone } : {}),
    delivery_schema: ozon.cfg.deliverySchema,
    delivery_type:
      destination.type === "PVZ"
        ? { pick_up: { map_point_id: Number(destination.mapPointId) } }
        : { courier: { coordinates: { latitude: destination.latitude, longitude: destination.longitude } } },
    items: items.map((i) => ({ sku: i.sku, ...(i.offerId ? { offer_id: i.offerId } : {}), quantity: i.quantity })),
  });
  const summary = summarizeCheckout(res);
  if (!summary.available) return { available: false, reason: summary.reason };

  // Ozon мог разбить корзину на отправления — но вернуть все позиции обязан.
  const covered = new Map<number, number>();
  for (const s of summary.splits) for (const i of s.items) covered.set(i.sku, (covered.get(i.sku) ?? 0) + i.quantity);
  if (items.some((i) => covered.get(i.sku) !== i.quantity)) return { available: false, reason: "PARTIAL" };

  const types = new Set(summary.splits.map((s) => s.deliveryType));
  const expected = destination.type === "PVZ" ? ["PVZ", "POSTAMAT"] : ["COURIER"];
  if ([...types].some((t) => !expected.includes(t))) return { available: false, reason: "DELIVERY_TYPE_MISMATCH" };

  return {
    available: true,
    deliveryType: destination.type,
    priceKopecks: summary.priceKopecks,
    maxDate: summary.maxDate,
    splits: summary.splits,
  };
}

// ---------------------------------------------------------------- защита публичных методов

const hits = new Map<string, { count: number; reset: number }>();

/**
 * Адрес клиента для ограничителя — из X-Forwarded-For, где каждый прокси дописывает адрес справа.
 * Значения левее доверенных прокси задаёт сам клиент, им не верим; X-Real-IP не читаем вовсе:
 * наши nginx (ops/dr/edge-setup.sh, vm-*.sh) его не ставят, и клиентский доходит до приложения как есть.
 * TRUSTED_PROXY_HOPS — сколько наших прокси дописывают XFF (по умолчанию 1: берём правое значение).
 */
export function clientKey(req: Request, env: NodeJS.ProcessEnv = process.env): string {
  const xff = req.headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  if (!xff?.length) return "local";
  const n = Number(env.TRUSTED_PROXY_HOPS);
  const hops = Number.isInteger(n) && n >= 1 ? n : 1;
  return xff[Math.max(0, xff.length - hops)];
}

/** Все лимиты сначала проверяются и только при успехе списываются: отклонённый запрос ничего не тратит. */
function allow(checks: { key: string; limit: number }[], windowMs: number): boolean {
  const now = Date.now();
  for (const c of checks) {
    const h = hits.get(c.key);
    if (h && h.reset > now && h.count >= c.limit) return false;
  }
  for (const c of checks) {
    const h = hits.get(c.key);
    if (!h || h.reset <= now) hits.set(c.key, { count: 1, reset: now + windowMs });
    else h.count++;
  }
  if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  return true;
}

/**
 * Не больше `limit` запросов за окно с одного адреса и не больше `limit × 20` со всех вместе:
 * публичные методы тратят общую квоту Ozon (50 rps на Client ID), и общий потолок держит её,
 * даже если прокси не передаёт настоящий адрес клиента. Отклонённые запросы потолок не тратят —
 * один настойчивый клиент не может закрыть метод для всех.
 */
export function allowRequest(req: Request, bucket: string, limit = 30, windowMs = 60_000): boolean {
  return allow(
    [
      { key: `${bucket}:${clientKey(req)}`, limit },
      { key: `${bucket}:*`, limit: limit * 20 },
    ],
    windowMs,
  );
}

/** Ключ (например, номер телефона) уже исчерпал лимит? Ничего не списывает. */
export function isLimited(key: string, limit: number): boolean {
  const h = hits.get(key);
  return Boolean(h && h.reset > Date.now() && h.count >= limit);
}

/** Засчитать событие по ключу (например, неудачную проверку номера). */
export function recordHit(key: string, windowMs: number): void {
  allow([{ key, limit: Number.POSITIVE_INFINITY }], windowMs);
}

export function resetRequestLimits() {
  hits.clear();
}
