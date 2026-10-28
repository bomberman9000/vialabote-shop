// Жизненный цикл заказа в Ozon Доставке: создание ТОЛЬКО после подтверждённой оплаты, опрос статусов,
// отмена, невыкупы и возвраты. Ничего отсюда не откатывает оплату: при сбое Ozon заказ сайта остаётся PAID,
// а OzonOrder получает состояние для ручного разбора (FAILED / UNKNOWN) и lastError без данных покупателя.
//
// Деньги покупателю здесь НЕ возвращаются: метода возврата Точки ещё нет. После подтверждённой отмены или
// невыкупа ставится refundState = "REQUIRED" — возврат делается вручную (следующий шаг — refund Точки).
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { OzonError, toOzonMoney, type ChosenSplit, type FbsPosting, type OrderCreateRequest, type OzonConfig, type OzonReturn } from "./ozon";
import { getProdOzon, quoteCart, type Ozon, type OzonDestination } from "./ozon-service";

export interface OzonRecipient {
  lastName: string;
  firstName: string;
  middleName?: string;
  phone: string; // +7XXXXXXXXXX
}

export interface OzonCourierAddress {
  city: string;
  street?: string;
  house: string;
  apartment?: string;
  entrance?: string;
  floor?: string;
  intercom?: string;
  region?: string;
  zip?: string;
  comment?: string;
}

/** Что сохраняется в OzonOrder.request при оформлении — этого достаточно, чтобы создать заказ после оплаты. */
export interface OzonOrderRequest {
  destination: OzonDestination;
  recipient: OzonRecipient;
  courier?: OzonCourierAddress;
}

/** Сколько раз пробовать заказ, который Ozon не принял по причине «повторите позже» (429, авторизация, сеть до отправки). */
export const MAX_CREATE_ATTEMPTS = 5;
/** CREATING дольше этого — процесс упал во время вызова: исход неизвестен. */
const STALE_CLAIM_MS = 10 * 60_000;
/** Сколько дней после оформления следить за возвратами доставленного/отменённого заказа. */
const RETURNS_WATCH_DAYS = 45;

const FINAL_POSTING = new Set(["delivered", "cancelled"]);

export type CreateResult =
  | { done: true; ozonOrderNumber: string; postingNumbers: string[] }
  | { done: false; state: string; reason: string };

function errText(err: unknown): string {
  if (err instanceof OzonError) return err.message;
  return err instanceof Error ? err.name : "unknown error";
}

async function finish(id: string, state: string, lastError: string | null, extra: Prisma.OzonOrderUpdateInput = {}) {
  await prisma.ozonOrder.update({ where: { id }, data: { state, lastError, ...extra } });
}

/**
 * Тело /v2/order/create из сохранённого при оформлении запроса и свежего расчёта (summarizeCheckout).
 * Одно и то же для боевого заказа и прогона в песочнице (scripts/ozon/sandbox-e2e.ts).
 */
export function buildOrderCreateBody(
  request: OzonOrderRequest,
  splits: ChosenSplit[],
  opts: { deliverySchema: OzonConfig["deliverySchema"]; deliveryPriceKopecks?: number | null; priceBySku: Map<number, number> },
): OrderCreateRequest {
  const r = request.recipient;
  return {
    buyer: { first_name: r.firstName, last_name: r.lastName, ...(r.middleName ? { middle_name: r.middleName } : {}), phone: r.phone },
    recipient: {
      recipient_first_name: r.firstName,
      recipient_last_name: r.lastName,
      ...(r.middleName ? { recipient_middle_name: r.middleName } : {}),
      recipient_phone: r.phone,
    },
    delivery:
      request.destination.type === "PVZ"
        ? { pick_up: { map_point_id: Number(request.destination.mapPointId) } }
        : {
            courier: {
              city: request.courier!.city,
              country: "Россия",
              house_number: request.courier!.house,
              coordinates: { latitude: request.destination.latitude, longitude: request.destination.longitude },
              ...(request.courier!.street ? { street: request.courier!.street } : {}),
              ...(request.courier!.apartment ? { apartment: request.courier!.apartment } : {}),
              ...(request.courier!.entrance ? { entrance: request.courier!.entrance } : {}),
              ...(request.courier!.floor ? { floor: request.courier!.floor } : {}),
              ...(request.courier!.intercom ? { intercom: request.courier!.intercom } : {}),
              ...(request.courier!.region ? { region: request.courier!.region } : {}),
              ...(request.courier!.zip ? { zip_code: request.courier!.zip } : {}),
              ...(request.courier!.comment ? { comment: request.courier!.comment } : {}),
            },
          },
    delivery_schema: opts.deliverySchema,
    splits: splits.map((s, idx) => ({
      delivery_method: {
        delivery_method_id: s.deliveryMethodId,
        delivery_type: s.deliveryType,
        logistic_date_range: s.logisticDateRange,
        timeslot_id: s.timeslotId,
        // Покупатель заплатил за доставку при оформлении; показываем эту сумму в первом отправлении.
        // Без объекта Ozon покажет покупателю «бесплатно».
        ...(idx === 0 && opts.deliveryPriceKopecks ? { price: toOzonMoney(opts.deliveryPriceKopecks) } : {}),
      },
      items: s.items.map((i) => ({
        sku: i.sku,
        ...(i.offerId ? { offer_id: i.offerId } : {}),
        quantity: i.quantity,
        price: toOzonMoney(opts.priceBySku.get(i.sku) ?? 0),
      })),
      warehouse_id: s.warehouseId,
    })),
  };
}

/**
 * Создать заказ в Ozon для ОПЛАЧЕННОГО заказа сайта. Идемпотентно: заказ берётся в работу атомарным
 * переходом PENDING -> CREATING, поэтому повтор вебхука или параллельный опрос второй заказ не создадут.
 * Никогда не бросает: результат — в OzonOrder.state.
 */
export async function createOzonOrderForPaid(orderId: string, ozon: Ozon | null = getProdOzon()): Promise<CreateResult> {
  if (!ozon) return { done: false, state: "DISABLED", reason: "Ozon Доставка выключена" };
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { ozon: true, items: { include: { product: { select: { ozonSku: true, ozonOfferId: true } } } } },
  });
  if (!order?.ozon) return { done: false, state: "NONE", reason: "заказ без доставки Ozon" };
  if (order.status !== "PAID") return { done: false, state: order.ozon.state, reason: `заказ не оплачен (${order.status})` };

  const claim = await prisma.ozonOrder.updateMany({
    where: { id: order.ozon.id, state: "PENDING" },
    data: { state: "CREATING", claimedAt: new Date(), attempts: { increment: 1 }, lastError: null },
  });
  if (claim.count === 0) return { done: false, state: order.ozon.state, reason: "уже в работе или обработан" };

  const id = order.ozon.id;
  const attempts = order.ozon.attempts + 1;
  // До отправки order/create любой сбой безопасен: заказа в Ozon точно нет, можно повторить.
  // 429 попыткой не считается: квота — временное состояние (в том числе от чужой нагрузки),
  // и оплаченный заказ не должен из-за неё уходить в FAILED.
  const retryLater = async (reason: string, countAttempt = true): Promise<CreateResult> => {
    const state = countAttempt && attempts >= MAX_CREATE_ATTEMPTS ? "FAILED" : "PENDING";
    await finish(id, state, reason, countAttempt ? {} : { attempts: order.ozon!.attempts });
    return { done: false, state, reason };
  };
  const is429 = (err: unknown) => err instanceof OzonError && err.kind === "http" && err.status === 429;

  const request = order.ozon.request as unknown as OzonOrderRequest;
  let body: OrderCreateRequest;
  try {
    const quote = await quoteCart(ozon, {
      lines: order.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      destination: request.destination,
      phone: request.recipient.phone,
    });
    if (!quote.available) {
      // Ozon сейчас не везёт (нет на складе, точка закрыта, …) — само не пройдёт, нужен человек.
      const reason = `checkout: ${quote.reason}`;
      await finish(id, "FAILED", reason);
      return { done: false, state: "FAILED", reason };
    }
    const priceBySku = new Map<number, number>();
    for (const i of order.items) if (i.product.ozonSku) priceBySku.set(Number(i.product.ozonSku), i.price);
    body = buildOrderCreateBody(request, quote.splits, {
      deliverySchema: ozon.cfg.deliverySchema,
      deliveryPriceKopecks: order.deliveryPrice,
      priceBySku,
    });
  } catch (err) {
    return retryLater(errText(err), !is429(err));
  }

  let res: { order_number?: string; postings?: string[] };
  try {
    res = await ozon.client.orderCreate(body);
  } catch (err) {
    if (err instanceof OzonError) {
      // 429 после всех повторов и сбои авторизации: запрос не выполнен — пробуем позже.
      if (err.kind === "http" && (err.status === 429 || err.status === 401 || err.path === "/oauth/token")) {
        return retryLater(err.message, !is429(err));
      }
      if (err.kind === "http" && err.status >= 400 && err.status < 500) {
        await finish(id, "FAILED", err.message);
        return { done: false, state: "FAILED", reason: err.message };
      }
    }
    // Таймаут, обрыв, 5xx: Ozon мог создать заказ. Повтор = риск второго реального заказа — только вручную.
    const reason = `${errText(err)}; заказ в Ozon мог создаться — сверьте в кабинете`;
    await finish(id, "UNKNOWN", reason);
    return { done: false, state: "UNKNOWN", reason };
  }

  if (!res.order_number) {
    const reason = "Ozon: ответ без номера заказа";
    await finish(id, "UNKNOWN", reason);
    return { done: false, state: "UNKNOWN", reason };
  }
  const postingNumbers = (res.postings ?? []).filter((p) => typeof p === "string");
  // Статус заказа сайта остаётся PAID: страница оплаты (/checkout/pay) ждёт именно его.
  await finish(id, "CREATED", null, { ozonOrderNumber: res.order_number, postingNumbers, status: "created" });
  return { done: true, ozonOrderNumber: res.order_number, postingNumbers };
}

/**
 * Из обработчика итогов оплаты (src/lib/payments/tochka-runtime.ts, onOutcome):
 *  - PAID — создать заказ в Ozon (идемпотентно; не успели или сбой «повторите позже» — доведёт опрос);
 *  - PAID_LATE — деньги пришли после отмены по таймеру, резерв на сайте уже снят: автоматически
 *    в Ozon не отправляем, помечаем для ручного разбора (нужно проверить наличие).
 */
export async function ozonAfterPayment(orderId: string, outcome: string): Promise<CreateResult | null> {
  if (outcome === "PAID") return createOzonOrderForPaid(orderId);
  if (outcome === "PAID_LATE") {
    await prisma.ozonOrder.updateMany({
      where: { orderId, state: "PENDING" },
      data: { state: "FAILED", lastError: "оплата пришла после отмены по таймеру — проверьте наличие и создайте вручную (retry)" },
    });
  }
  return null;
}

// ---------------------------------------------------------------- статусы (polling)

/** Сводный статус отправлений заказа. */
export function aggregateStatus(statuses: string[]): string {
  if (statuses.length === 0) return "created";
  if (statuses.every((s) => s === "delivered")) return "delivered";
  if (statuses.every((s) => s === "cancelled")) return "cancelled";
  if (statuses.every((s) => FINAL_POSTING.has(s))) return "partially_delivered";
  if (statuses.some((s) => ["delivering", "driver_pickup", "sent_by_seller", "delivered"].includes(s))) return "delivering";
  return "awaiting";
}

/** Статус заказа сайта по статусу Ozon. Только вперёд: PAID -> SHIPPED -> COMPLETED. */
const ORDER_STEP: Record<string, number> = { PAID: 0, PROCESSING: 1, SHIPPED: 2, COMPLETED: 3 };
function siteStatusFor(status: string): string | null {
  if (status === "delivering") return "SHIPPED";
  if (status === "delivered" || status === "partially_delivered") return "COMPLETED";
  return null;
}

async function advanceOrder(orderId: string, current: string, target: string | null) {
  if (!target || !(current in ORDER_STEP) || ORDER_STEP[target] <= ORDER_STEP[current]) return;
  await prisma.order.updateMany({ where: { id: orderId, status: current }, data: { status: target } });
}

function cancelConfirmed(state: string | undefined) {
  return state === "Подтверждена";
}

export interface SyncReport {
  created: number;
  synced: number;
  stale: number;
  errors: string[];
}

/** Обновить один заказ: номера и статусы отправлений, статус отмены, возвраты. */
export async function syncOzonOrder(ozonOrderId: string, ozon: Ozon): Promise<void> {
  const oo = await prisma.ozonOrder.findUniqueOrThrow({ where: { id: ozonOrderId }, include: { order: true } });
  if (!oo.ozonOrderNumber) return;
  let postingNumbers = oo.postingNumbers;

  // order/create может вернуть не все отправления — добираем список по номеру заказа (только FBS).
  if (ozon.cfg.deliverySchema === "FBS") {
    const since = new Date(oo.createdAt.getTime() - 24 * 3600_000).toISOString();
    const to = new Date(Date.now() + 24 * 3600_000).toISOString();
    const found = new Set(postingNumbers);
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const list = await ozon.client.fbsPostingList({ since, to, order_numbers: [oo.ozonOrderNumber] }, cursor);
      for (const p of list.postings ?? []) if (p.posting_number && p.order_number === oo.ozonOrderNumber) found.add(p.posting_number);
      if (!list.has_next || !list.cursor) break;
      cursor = list.cursor;
    }
    postingNumbers = [...found];
  }

  const postings: Record<string, Pick<FbsPosting, "status" | "substatus" | "tracking_number" | "delivering_date">> = {};
  for (const n of postingNumbers) {
    const p = (await ozon.client.fbsPostingGet(n)).result;
    if (p) postings[n] = { status: p.status, substatus: p.substatus, tracking_number: p.tracking_number, delivering_date: p.delivering_date };
  }
  const status = aggregateStatus(Object.values(postings).map((p) => p.status ?? "unknown"));

  const data: Prisma.OzonOrderUpdateInput = {
    postingNumbers,
    postings: postings as Prisma.InputJsonValue,
    status,
    syncedAt: new Date(),
    lastError: null,
  };

  let orderCancelled = false;
  if (oo.state === "CANCELLING") {
    const c = await ozon.client.orderCancelStatus(oo.ozonOrderNumber);
    data.cancelState = c.state ?? null;
    if (cancelConfirmed(c.state)) {
      data.state = "CANCELLED";
      orderCancelled = true;
    } else if (c.state === "Отклонена") {
      data.state = "CREATED";
    }
  }
  if (status === "cancelled" && oo.state !== "CANCELLED") {
    data.state = "CANCELLED"; // Ozon отменил сам (истёк срок хранения, сбой склада, …)
    orderCancelled = true;
  }

  // Невыкупы и частичные отказы видны только в returns/list.
  let returns: OzonReturn[] = [];
  const watchReturns = status !== "awaiting" && status !== "created";
  if (watchReturns && postingNumbers.length) {
    for (let i = 0; i < postingNumbers.length; i += 50) {
      const r = await ozon.client.returnsList(postingNumbers.slice(i, i + 50));
      returns = returns.concat(r.returns ?? []);
    }
    data.returns = returns.map((r) => ({
      id: r.id,
      type: r.type,
      posting_number: r.posting_number,
      sku: r.product?.sku,
      offer_id: r.product?.offer_id,
      quantity: r.product?.quantity,
      status: r.visual?.status?.sys_name,
      reason: r.return_reason_name,
      changed: r.visual?.change_moment,
    })) as Prisma.InputJsonValue;
  }
  if ((orderCancelled || returns.length > 0) && oo.refundState !== "DONE") data.refundState = "REQUIRED";

  await prisma.ozonOrder.update({ where: { id: oo.id }, data });
  if (orderCancelled) {
    await prisma.order.updateMany({ where: { id: oo.orderId, status: { in: ["PAID", "PROCESSING", "SHIPPED"] } }, data: { status: "CANCELLED" } });
  } else {
    await advanceOrder(oo.orderId, oo.order.status, siteStatusFor(status));
  }
}

/**
 * Опрос (scripts/ozon/sync.ts, systemd-таймер): довести неотправленные оплаченные заказы, пометить зависшие,
 * обновить статусы. Вебхуки Ozon не регистрируются — источник истины этот опрос.
 */
export async function syncOzonOrders(
  ozon: Ozon | null = getProdOzon(),
  { limit = 100, orderIds }: { limit?: number; orderIds?: string[] } = {},
): Promise<SyncReport> {
  const report: SyncReport = { created: 0, synced: 0, stale: 0, errors: [] };
  if (!ozon) return report;
  const only = orderIds ? { orderId: { in: orderIds } } : {};

  const stale = await prisma.ozonOrder.updateMany({
    where: { ...only, state: "CREATING", claimedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) } },
    data: { state: "UNKNOWN", lastError: "создание прервано; заказ в Ozon мог создаться — сверьте в кабинете" },
  });
  report.stale = stale.count;

  const pending = await prisma.ozonOrder.findMany({
    where: { ...only, state: "PENDING", order: { status: "PAID" } },
    select: { orderId: true },
    take: limit,
  });
  for (const p of pending) {
    const r = await createOzonOrderForPaid(p.orderId, ozon);
    if (r.done) report.created++;
  }

  const watchFrom = new Date(Date.now() - RETURNS_WATCH_DAYS * 24 * 3600_000);
  const active = await prisma.ozonOrder.findMany({
    where: {
      ...only,
      ozonOrderNumber: { not: null },
      OR: [
        // status = NULL явно: NOT IN в SQL отбрасывает NULL, и свежий заказ без статуса выпал бы из опроса.
        {
          state: { in: ["CREATED", "CANCELLING"] },
          OR: [{ status: null }, { status: { notIn: ["delivered", "cancelled", "partially_delivered"] } }],
        },
        { state: { in: ["CREATED", "CANCELLED"] }, createdAt: { gte: watchFrom } },
      ],
    },
    orderBy: { syncedAt: { sort: "asc", nulls: "first" } },
    select: { id: true },
    take: limit,
  });
  for (const a of active) {
    try {
      await syncOzonOrder(a.id, ozon);
      report.synced++;
    } catch (err) {
      report.errors.push(errText(err));
      await prisma.ozonOrder.update({ where: { id: a.id }, data: { lastError: errText(err), syncedAt: new Date() } });
    }
  }
  return report;
}

// ---------------------------------------------------------------- отмена

/** Причина «Не нашёл нужную причину» из справочника Ozon — для отмены продавцом по просьбе покупателя. */
export const DEFAULT_CANCEL_REASON = 508;

export type CancelResult =
  | { ok: true; state: "CANCELLED" | "CANCELLING"; cancelState: string | null }
  | { ok: false; reason: string };

/**
 * Отмена: v1/order/cancel/check -> v1/order/cancel -> v1/order/cancel/status.
 * Деньги не возвращаются автоматически: после подтверждения отмены — refundState = REQUIRED.
 */
export async function cancelOzonOrder(
  orderId: string,
  { reasonId, message }: { reasonId?: number; message?: string } = {},
  ozon: Ozon | null = getProdOzon(),
): Promise<CancelResult> {
  const oo = await prisma.ozonOrder.findUnique({ where: { orderId } });
  if (!oo) return { ok: false, reason: "заказ без доставки Ozon" };

  // В Ozon ещё ничего нет: отменяем у себя, атомарно — параллельное создание после этого не начнётся.
  if (oo.state === "PENDING" || oo.state === "FAILED") {
    const { count } = await prisma.ozonOrder.updateMany({
      where: { id: oo.id, state: oo.state },
      data: { state: "CANCELLED", cancelState: "local" },
    });
    if (count === 0) return { ok: false, reason: "состояние изменилось, повторите" };
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.status !== "AWAITING_PAYMENT" && order.status !== "NEW") {
      await prisma.ozonOrder.update({ where: { id: oo.id }, data: { refundState: "REQUIRED" } });
    }
    return { ok: true, state: "CANCELLED", cancelState: null };
  }
  if (oo.state !== "CREATED" || !oo.ozonOrderNumber) return { ok: false, reason: `отмена из состояния ${oo.state} невозможна` };
  if (!ozon) return { ok: false, reason: "Ozon Доставка выключена" };

  const check = await ozon.client.orderCancelCheck(oo.ozonOrderNumber);
  if (!check.cancellable) {
    const why = (check.postings ?? []).map((p) => p.why_not_cancellable).filter(Boolean).join("; ");
    return { ok: false, reason: `Ozon: отмена невозможна${why ? ` — ${why}` : ""}` };
  }
  const reasons = (await ozon.client.cancelReasonsByOrder(oo.ozonOrderNumber)).reasons ?? [];
  const ids = reasons.map((r) => r.id).filter((x): x is number => typeof x === "number");
  const reason = reasonId && ids.includes(reasonId) ? reasonId : ids.includes(DEFAULT_CANCEL_REASON) ? DEFAULT_CANCEL_REASON : ids[0];
  if (!reason) return { ok: false, reason: "Ozon не вернул причин отмены" };

  const { count } = await prisma.ozonOrder.updateMany({ where: { id: oo.id, state: "CREATED" }, data: { state: "CANCELLING" } });
  if (count === 0) return { ok: false, reason: "состояние изменилось, повторите" };
  try {
    await ozon.client.orderCancel(oo.ozonOrderNumber, reason, message);
  } catch (err) {
    // Ozon явно отказал — отмены нет. Сеть/таймаут — исход неизвестен, оставляем CANCELLING: статус уточнит опрос.
    if (err instanceof OzonError && err.kind === "http" && err.status >= 400 && err.status < 500) {
      await finish(oo.id, "CREATED", err.message);
      return { ok: false, reason: err.message };
    }
    await prisma.ozonOrder.update({ where: { id: oo.id }, data: { lastError: errText(err) } });
    return { ok: true, state: "CANCELLING", cancelState: null };
  }

  const status = await ozon.client.orderCancelStatus(oo.ozonOrderNumber).catch(() => ({ state: undefined }));
  const confirmed = cancelConfirmed(status.state);
  await prisma.ozonOrder.update({
    where: { id: oo.id },
    data: { cancelState: status.state ?? null, ...(confirmed ? { state: "CANCELLED", refundState: "REQUIRED" } : {}) },
  });
  if (confirmed) {
    await prisma.order.updateMany({ where: { id: orderId, status: { in: ["PAID", "PROCESSING", "SHIPPED"] } }, data: { status: "CANCELLED" } });
  }
  return { ok: true, state: confirmed ? "CANCELLED" : "CANCELLING", cancelState: status.state ?? null };
}

/**
 * Повторить создание после ручного разбора. Из UNKNOWN — только если человек проверил кабинет Ozon
 * и заказа там нет (confirmNotInOzon), иначе появится второй реальный заказ.
 */
export async function retryOzonOrder(orderId: string, { confirmNotInOzon = false } = {}): Promise<CreateResult> {
  const oo = await prisma.ozonOrder.findUnique({ where: { orderId } });
  if (!oo) return { done: false, state: "NONE", reason: "заказ без доставки Ozon" };
  if (oo.state === "UNKNOWN" && !confirmNotInOzon) {
    return { done: false, state: "UNKNOWN", reason: "сначала проверьте кабинет Ozon: заказ мог уже создаться" };
  }
  if (oo.state !== "FAILED" && oo.state !== "UNKNOWN") return { done: false, state: oo.state, reason: "повтор не нужен" };
  await prisma.ozonOrder.updateMany({ where: { id: oo.id, state: oo.state }, data: { state: "PENDING", attempts: 0 } });
  return createOzonOrderForPaid(orderId);
}
