// Полный сценарий заказа Ozon Доставки в ПЕСОЧНИЦЕ (api-seller-sandbox.ozon.ru): ПВЗ -> расчёт -> order/create ->
// отправления -> (смена статуса) -> отмена. Тело order/create строит тот же buildOrderCreateBody, что и боевой заказ.
// Любой запрос не на хост песочницы блокируется до сети — реальный заказ этим скриптом создать нельзя.
//
// usage (на сервере, из каталога приложения; нужен OZON_APP_CLIENT_SECRET_SANDBOX, OZON_ENV в app.env не важен):
//   systemd-run --quiet --wait --pipe --collect -p EnvironmentFile=/etc/vialabote-shop/app.env \
//     -p WorkingDirectory=/opt/vialabote-shop/current -E PATH=/opt/vialabote-shop/node-v24.21.0/bin:/usr/bin:/bin \
//     /opt/vialabote-shop/current/node_modules/.bin/tsx scripts/ozon/sandbox-e2e.ts [флаги]
// (не `set -a; . app.env`: bash теряет DATABASE_URL с «&» в адресе; systemd читает файл как сервис)
// флаги: --dry (без order/create)  --keep (не отменять)  --advance N (сдвинуть статус отправлений N раз)
//        --phone +79990000001  --sku 123 --offer ABC  --point 123456  --schema FBS|FBO|MIX  --price 100 (руб. за штуку)
import { prisma } from "@/lib/prisma";
import { createOzonClient, OzonError, ozonConfig, SANDBOX_BASE, summarizeCheckout, type LatLong, type OzonConfig, type QuoteSummary } from "@/lib/delivery/ozon";
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

  console.log("\n== Товары");
  // Тестовые товары песочницы доставляются не везде (BANNED_FOR_AREA, нет таймслотов) — берём несколько и перебираем.
  const candidates: { sku: number; offer?: string }[] = [];
  if (arg("sku")) candidates.push({ sku: Number(arg("sku")), offer: arg("offer") });
  else {
    const list = await step("v3/product/list", () =>
      client.call<{ result?: { items?: { product_id?: number; offer_id?: string }[] } }>("/v3/product/list", {
        filter: { visibility: "ALL" },
        last_id: "",
        limit: 100,
      }),
    );
    const offers = (list?.result?.items ?? []).map((i) => i.offer_id).filter((o): o is string => !!o);
    const st = offers.length ? await step("v4/product/info/stocks", () => client.productStocks(offers.slice(0, 100))) : null;
    for (const i of st?.items ?? []) {
      const s = (i.stocks ?? []).find((x) => x.sku && (x.present ?? 0) - (x.reserved ?? 0) > 0);
      if (s?.sku) candidates.push({ sku: s.sku, offer: i.offer_id });
    }
  }
  console.log(`  с остатком: ${candidates.length}`);
  if (!candidates.length) {
    console.log("  Нет товара с остатком: передайте --sku (и --offer) товара песочницы.");
    return;
  }

  console.log("\n== ПВЗ");
  const CITIES: { name: string; at: LatLong }[] = [
    { name: "Москва", at: MOSCOW },
    { name: "Санкт-Петербург", at: { lat: 59.9386, long: 30.3141 } },
    { name: "Казань", at: { lat: 55.7963, long: 49.1088 } },
    { name: "Самара", at: { lat: 53.1959, long: 50.1002 } },
    { name: "Екатеринбург", at: { lat: 56.8389, long: 60.6057 } },
    { name: "Новосибирск", at: { lat: 55.0302, long: 82.9204 } },
  ];
  let points: { id: string; name: string }[] = [];
  if (arg("point")) points = [{ id: arg("point")!, name: "--point" }];
  else {
    const pts = await step("point/list", () => client.deliveryPointList());
    const all = (pts?.points ?? []).filter((p) => p.coordinate && p.map_point_id).map((p) => ({ id: String(p.map_point_id), lat: p.coordinate!.lat, long: p.coordinate!.long }));
    console.log(`  точек: ${all.length}`);
    for (const c of CITIES) {
      const near = all.map((p) => ({ id: p.id, km: distanceKm(c.at, p) })).sort((a, b) => a.km - b.km)[0];
      if (near) points.push({ id: near.id, name: `${c.name} (${near.km.toFixed(1)} км от центра)` });
    }
  }
  if (!points.length) return;

  console.log("\n== Покупатель и расчёт");
  const can = await step("delivery/check", () => client.deliveryCheck(phone));
  console.log(`  ${phone}: доставка ${can?.is_possible ? "возможна" : "НЕвозможна"}`);
  const schemas = (arg("schema") ? [arg("schema")!] : [cfg.deliverySchema, "FBS", "FBO", "MIX"]).filter((x, i, a) => a.indexOf(x) === i) as OzonConfig["deliverySchema"][];
  const misses = new Map<string, number>();
  let found: { schema: OzonConfig["deliverySchema"]; point: { id: string; name: string }; item: { sku: number; offer?: string }; q: Extract<QuoteSummary, { available: true }> } | null = null;
  search: for (const schema of schemas) {
    for (const point of points) {
      for (const item of candidates) {
        const res = await step(`checkout ${schema} ${point.id} ${item.sku}`, () =>
          client.deliveryCheckout({
            buyer_phone: phone,
            delivery_schema: schema,
            delivery_type: { pick_up: { map_point_id: Number(point.id) } },
            items: [{ sku: item.sku, quantity: 1 }],
          }),
        );
        if (!res) continue;
        const q = summarizeCheckout(res);
        if (q.available) {
          found = { schema, point, item, q };
          break search;
        }
        misses.set(`${schema}: ${q.reason}`, (misses.get(`${schema}: ${q.reason}`) ?? 0) + 1);
      }
    }
  }
  if (!found) {
    console.log(`  доставляемой пары «товар + ПВЗ» нет; причины: ${[...misses].map(([k, v]) => `${k} ×${v}`).join(", ")}`);
    return;
  }
  const { schema, point, item, q } = found;
  const sku = item.sku;
  const info = await step("point/info", () => client.deliveryPointInfo([point.id]));
  console.log(`  ✓ схема ${schema}, ПВЗ ${point.id} — ${point.name}: ${info?.points?.[0]?.delivery_method?.address ?? "?"}`);
  console.log(`  ✓ sku ${sku}${item.offer ? ` (${item.offer})` : ""}: ${(q.priceKopecks / 100).toFixed(2)} ₽, получение не позднее ${formatDeliveryDate(q.maxDate)} (${q.maxDate}), отправлений ${q.splits.length}`);
  if (misses.size) console.log(`  (до этого не подошло: ${[...misses].map(([k, v]) => `${k} ×${v}`).join(", ")})`);

  const body = buildOrderCreateBody(
    { destination: { type: "PVZ", mapPointId: point.id }, recipient: { lastName: "Тестов", firstName: "Тест", phone } },
    q.splits,
    { deliverySchema: schema, deliveryPriceKopecks: q.priceKopecks, priceBySku: new Map([[sku, Math.round(Number(arg("price") ?? 100) * 100)]]) },
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
