// Полный сценарий заказа Ozon Доставки в ПЕСОЧНИЦЕ (api-seller-sandbox.ozon.ru): ПВЗ -> расчёт -> order/create ->
// отправления -> (смена статуса) -> отмена. Тело order/create строит тот же buildOrderCreateBody, что и боевой заказ.
// Любой запрос не на хост песочницы блокируется до сети — реальный заказ этим скриптом создать нельзя.
//
// usage (на сервере, из каталога приложения; нужен OZON_APP_CLIENT_SECRET_SANDBOX, OZON_ENV в app.env не важен):
//   sudo bash -c 'set -a; . /etc/vialabote-shop/app.env; set +a; cd /opt/vialabote-shop/current && npx tsx scripts/ozon/sandbox-e2e.ts [флаги]'
// флаги: --dry (без order/create)  --keep (не отменять)  --advance N (сдвинуть статус отправлений N раз)
//        --phone +79990000001  --sku 123 --offer ABC  --point 123456  --price 100 (руб. за штуку)
import { prisma } from "@/lib/prisma";
import { createOzonClient, OzonError, ozonConfig, SANDBOX_BASE, summarizeCheckout, type LatLong } from "@/lib/delivery/ozon";
import { createTokenStore } from "@/lib/delivery/ozon-token";
import { distanceKm } from "@/lib/delivery/ozon-service";
import { buildOrderCreateBody, DEFAULT_CANCEL_REASON } from "@/lib/delivery/ozon-orders";
import { formatDeliveryDate } from "@/lib/delivery/format";

const MOSCOW: LatLong = { lat: 55.7558, long: 37.6173 };

let lastErrorText = "";
const sandboxOnly: typeof fetch = async (url, init) => {
  const u = new URL(String(url));
  if (u.origin !== SANDBOX_BASE) throw new Error(`sandbox-e2e: запрос на ${u.origin} заблокирован — только песочница`);
  const res = await fetch(url, init);
  if (!res.ok) lastErrorText = (await res.clone().text().catch(() => "")).replace(/\s+/g, " ").slice(0, 400);
  return res;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function step<T>(title: string, fn: () => Promise<T>): Promise<T | null> {
  lastErrorText = "";
  try {
    const r = await fn();
    return r;
  } catch (err) {
    const msg = err instanceof OzonError || err instanceof Error ? err.message : String(err);
    console.log(`  ✗ ${title}: ${msg}${lastErrorText ? `\n    ответ Ozon: ${lastErrorText}` : ""}`);
    return null;
  }
}

async function main() {
  const cfg = ozonConfig({ ...process.env, OZON_ENV: "sandbox" });
  if (!cfg) throw new Error("Нет OZON_APP_CLIENT_ID / OZON_APP_CLIENT_SECRET_SANDBOX");
  if (cfg.base !== SANDBOX_BASE || cfg.oauthBase !== SANDBOX_BASE) throw new Error("sandbox-e2e: конфигурация не песочница — остановлено");

  const tokens = createTokenStore(cfg, { prisma, fetch: sandboxOnly });
  const client = createOzonClient(cfg, { fetch: sandboxOnly, getAccessToken: (f) => tokens.getAccessToken(f) });
  console.log(`== Песочница ${SANDBOX_BASE}`);
  if (!(await step("токен (client_credentials)", () => tokens.getAccessToken()))) return;
  console.log("  ✓ токен получен (сохранён в OzonOAuthToken 'sandbox', не печатается)");

  console.log("\n== Тестовые покупатели (/v1/sandbox/user/list)");
  const users = await step("user/list", () => client.call<Record<string, unknown>>("/v1/sandbox/user/list", {}));
  if (users) console.log(`  ${JSON.stringify(users).slice(0, 600)}`);
  const phone = arg("phone") ?? "+79990000001";

  console.log("\n== Товар");
  let sku = arg("sku") ? Number(arg("sku")) : undefined;
  let offer = arg("offer");
  if (!sku) {
    const list = await step("v3/product/list", () =>
      client.call<{ result?: { items?: { product_id?: number; offer_id?: string }[] } }>("/v3/product/list", {
        filter: { visibility: "ALL" },
        last_id: "",
        limit: 100,
      }),
    );
    const offers = (list?.result?.items ?? []).map((i) => i.offer_id).filter((o): o is string => !!o);
    console.log(`  товаров в песочнице: ${offers.length}`);
    const st = offers.length ? await step("v4/product/info/stocks", () => client.productStocks(offers.slice(0, 100))) : null;
    for (const i of st?.items ?? []) {
      const s = (i.stocks ?? []).find((x) => x.sku && (x.present ?? 0) - (x.reserved ?? 0) > 0) ?? (i.stocks ?? []).find((x) => x.sku);
      if (s?.sku) {
        sku = s.sku;
        offer = i.offer_id;
        console.log(`  выбран offer_id ${offer}, sku ${sku} (${s.type ?? "?"}: present ${s.present ?? 0}, reserved ${s.reserved ?? 0})`);
        break;
      }
    }
  }
  if (!sku) {
    console.log("  Нет SKU: передайте --sku (и --offer) товара песочницы.");
    return;
  }
  const item = { sku, ...(offer ? { offer_id: offer } : {}), quantity: 1 };

  console.log("\n== ПВЗ");
  let point = arg("point");
  if (!point) {
    const pts = await step("point/list", () => client.deliveryPointList());
    const near = (pts?.points ?? [])
      .filter((p) => p.coordinate && p.map_point_id)
      .map((p) => ({ id: String(p.map_point_id), km: distanceKm(MOSCOW, { lat: p.coordinate!.lat, long: p.coordinate!.long }) }))
      .sort((a, b) => a.km - b.km)[0];
    console.log(`  точек: ${pts?.points?.length ?? 0}${near ? `; ближайшая к центру Москвы ${near.id} (${near.km.toFixed(1)} км)` : ""}`);
    point = near?.id;
  }
  if (!point) return;
  const info = await step("point/info", () => client.deliveryPointInfo([point!]));
  console.log(`  ПВЗ ${point}: ${info?.points?.[0]?.delivery_method?.address ?? "?"}`);

  console.log("\n== Покупатель и расчёт");
  const can = await step("delivery/check", () => client.deliveryCheck(phone));
  console.log(`  ${phone}: доставка ${can?.is_possible ? "возможна" : "НЕвозможна"}`);
  const res = await step("v2/delivery/checkout", () =>
    client.deliveryCheckout({ buyer_phone: phone, delivery_schema: cfg.deliverySchema, delivery_type: { pick_up: { map_point_id: Number(point) } }, items: [item] }),
  );
  if (!res) return;
  const q = summarizeCheckout(res);
  if (!q.available) {
    console.log(`  недоступно: ${q.reason}`);
    return;
  }
  console.log(`  ✓ ${(q.priceKopecks / 100).toFixed(2)} ₽, получение не позднее ${formatDeliveryDate(q.maxDate)} (${q.maxDate}), отправлений ${q.splits.length}`);

  const body = buildOrderCreateBody(
    { destination: { type: "PVZ", mapPointId: point }, recipient: { lastName: "Тестов", firstName: "Тест", phone } },
    q.splits,
    { deliverySchema: cfg.deliverySchema, deliveryPriceKopecks: q.priceKopecks, priceBySku: new Map([[sku, Math.round(Number(arg("price") ?? 100) * 100)]]) },
  );
  if (flag("dry")) {
    console.log("\n--dry: тело order/create (в Ozon не отправлено):");
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  console.log("\n== Заказ (/v2/order/create, песочница)");
  const created = await step("order/create", () => client.orderCreate(body));
  if (!created?.order_number) {
    if (created) console.log(`  ответ без order_number: ${JSON.stringify(created).slice(0, 300)}`);
    return;
  }
  const orderNumber = created.order_number;
  console.log(`  ✓ заказ ${orderNumber}, отправления: ${(created.postings ?? []).join(", ") || "—"}`);

  const listPostings = async () => {
    const now = Date.now();
    const l = await step("v4/posting/fbs/list", () =>
      client.fbsPostingList({ since: new Date(now - 86_400_000).toISOString(), to: new Date(now + 86_400_000).toISOString(), order_numbers: [orderNumber] }),
    );
    for (const p of l?.postings ?? []) console.log(`  отправление ${p.posting_number}: ${p.status}${p.substatus ? ` / ${p.substatus}` : ""}`);
    return (l?.postings ?? []).map((p) => p.posting_number).filter((n): n is string => !!n);
  };
  console.log("\n== Отправления");
  const postings = (await listPostings()).concat((created.postings ?? []).filter((p) => typeof p === "string"));
  const unique = [...new Set(postings)];

  const advance = Number(arg("advance") ?? 0);
  for (let i = 0; i < advance; i++) {
    for (const n of unique) await step(`status/change ${n}`, () => client.call("/v1/sandbox/posting/status/change", { posting_number: n }));
    console.log(`  — после смены статуса #${i + 1}:`);
    await listPostings();
  }

  if (flag("keep")) {
    console.log(`\n--keep: заказ ${orderNumber} оставлен в песочнице`);
    return;
  }
  console.log("\n== Отмена");
  const check = await step("order/cancel/check", () => client.orderCancelCheck(orderNumber));
  console.log(`  можно отменить: ${check?.cancellable ? "да" : "нет"}${check?.postings?.map((p) => `; ${p.posting_number}: ${p.cancellable ? "да" : `нет (${p.why_not_cancellable ?? "?"})`}`).join("") ?? ""}`);
  if (!check?.cancellable) return;
  const reasons = await step("cancel-reason/list-by-order", () => client.cancelReasonsByOrder(orderNumber));
  const ids = (reasons?.reasons ?? []).map((r) => r.id).filter((x): x is number => typeof x === "number");
  const reasonId = ids.includes(DEFAULT_CANCEL_REASON) ? DEFAULT_CANCEL_REASON : (ids[0] ?? DEFAULT_CANCEL_REASON);
  console.log(`  причины: ${ids.join(", ") || "—"}; берём ${reasonId}`);
  if (!(await step("order/cancel", () => client.orderCancel(orderNumber, reasonId, "Проверка интеграции в песочнице")))) return;
  const st = await step("order/cancel/status", () => client.orderCancelStatus(orderNumber));
  console.log(`  статус отмены: ${st?.state ?? "?"}`);
  console.log("\nГотово: сценарий песочницы пройден.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
