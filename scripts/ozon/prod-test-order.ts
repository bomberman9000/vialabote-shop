// Тестовый заказ в БОЕВОМ Ozon (настоящая отправка) — тем же buildOrderCreateBody и клиентом, что заказ сайта.
// Заказ сайта и оплата не создаются. Без --yes ничего не создаёт: только расчёт и тело запроса.
//
//   ... tsx scripts/ozon/prod-test-order.ts --list                           товары с остатком FBS (только чтение)
//   ... tsx scripts/ozon/prod-test-order.ts --phone +79XXXXXXXXX --sku N      расчёт до ближайшего ПВЗ (--city / --point)
//         [--offer A] [--city Самара] [--point ID] [--price 100] [--last Фамилия --first Имя]
//   ... + --yes                                                              создать заказ (реальный!)
//   ... tsx scripts/ozon/prod-test-order.ts --cancel <order_number>          отменить (cancel/check -> cancel -> status)
// Запуск — как scripts/ozon/check.ts (systemd-run с EnvironmentFile сервиса).
import { prisma } from "@/lib/prisma";
import { createOzonClient, normalizeRuPhone, OzonError, ozonConfig, summarizeCheckout, type LatLong } from "@/lib/delivery/ozon";
import { createTokenStore } from "@/lib/delivery/ozon-token";
import { distanceKm } from "@/lib/delivery/ozon-service";
import { buildOrderCreateBody, DEFAULT_CANCEL_REASON } from "@/lib/delivery/ozon-orders";
import { formatDeliveryDate } from "@/lib/delivery/format";

const CITIES: Record<string, LatLong> = {
  Москва: { lat: 55.7558, long: 37.6173 },
  Самара: { lat: 53.1959, long: 50.1002 },
  Новосибирск: { lat: 55.0302, long: 82.9204 },
  "Санкт-Петербург": { lat: 59.9386, long: 30.3141 },
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

let lastErrorText = "";
const recording: typeof fetch = async (url, init) => {
  const res = await fetch(url, init);
  if (!res.ok) lastErrorText = (await res.clone().text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
  return res;
};

async function main() {
  const cfg = ozonConfig({ ...process.env, OZON_ENV: "prod" });
  if (!cfg || cfg.env !== "prod") throw new Error("Нет боевого приложения Ozon (OZON_APP_CLIENT_ID / OZON_APP_CLIENT_SECRET)");
  const tokens = createTokenStore(cfg, { prisma, fetch: recording });
  const client = createOzonClient(cfg, { fetch: recording, getAccessToken: (f) => tokens.getAccessToken(f) });

  if (flag("list")) {
    const list = await client.call<{ result?: { items?: { offer_id?: string; archived?: boolean }[] } }>("/v3/product/list", {
      filter: { visibility: "ALL" },
      last_id: "",
      limit: 1000,
    });
    const offers = (list.result?.items ?? []).map((i) => i.offer_id).filter((o): o is string => !!o);
    console.log(`товаров в кабинете: ${offers.length}`);
    for (let i = 0; i < offers.length; i += 100) {
      const st = await client.productStocks(offers.slice(i, i + 100));
      for (const it of st.items ?? []) {
        const fbs = (it.stocks ?? []).filter((s) => s.type === "fbs");
        const line = (it.stocks ?? []).map((s) => `${s.type}: sku ${s.sku ?? "?"}, есть ${s.present ?? 0}, резерв ${s.reserved ?? 0}`).join("; ");
        console.log(`${fbs.some((s) => (s.present ?? 0) - (s.reserved ?? 0) > 0) ? "✓" : "·"} ${it.offer_id}: ${line || "остатков нет"}`);
      }
    }
    return;
  }

  const cancel = arg("cancel");
  if (cancel) {
    const check = await client.orderCancelCheck(cancel);
    console.log(`можно отменить: ${check.cancellable ? "да" : "нет"}`);
    if (!check.cancellable) return;
    const ids = ((await client.cancelReasonsByOrder(cancel)).reasons ?? []).map((r) => r.id).filter((x): x is number => typeof x === "number");
    const reason = ids.includes(DEFAULT_CANCEL_REASON) ? DEFAULT_CANCEL_REASON : (ids[0] ?? DEFAULT_CANCEL_REASON);
    await client.orderCancel(cancel, reason, "Тестовый заказ интеграции");
    console.log(`отмена запрошена (причина ${reason}); статус: ${(await client.orderCancelStatus(cancel)).state ?? "?"}`);
    return;
  }

  const phone = normalizeRuPhone(arg("phone") ?? "");
  const sku = Number(arg("sku"));
  if (!phone || !Number.isSafeInteger(sku) || sku <= 0) throw new Error("usage: --phone +79XXXXXXXXX --sku N [--city Самара | --point ID] [--yes]");
  const offer = arg("offer");

  let point = arg("point");
  if (!point) {
    const at = CITIES[arg("city") ?? "Самара"];
    if (!at) throw new Error(`--city: ${Object.keys(CITIES).join(", ")}`);
    const pts = await client.deliveryPointList();
    point = (pts.points ?? [])
      .filter((p) => p.coordinate && p.map_point_id)
      .map((p) => ({ id: String(p.map_point_id), km: distanceKm(at, { lat: p.coordinate!.lat, long: p.coordinate!.long }) }))
      .sort((a, b) => a.km - b.km)[0]?.id;
    if (!point) throw new Error("ПВЗ не найдены");
  }
  const info = await client.deliveryPointInfo([point]);
  console.log(`ПВЗ ${point}: ${info.points?.[0]?.delivery_method?.address ?? "?"}`);
  console.log(`аккаунт Ozon у номера: ${(await client.deliveryCheck(phone)).is_possible ? "есть" : "НЕТ — заказ не получить"}`);

  const res = await client.deliveryCheckout({
    buyer_phone: phone,
    delivery_schema: cfg.deliverySchema,
    delivery_type: { pick_up: { map_point_id: Number(point) } },
    items: [{ sku, ...(offer ? { offer_id: offer } : {}), quantity: 1 }],
  });
  const q = summarizeCheckout(res);
  if (!q.available) {
    console.log(`Ozon не доставит: ${q.reason}`);
    return;
  }
  console.log(`доставка ${(q.priceKopecks / 100).toFixed(2)} ₽, получение не позднее ${formatDeliveryDate(q.maxDate)}, отправлений ${q.splits.length}`);

  const body = buildOrderCreateBody(
    {
      destination: { type: "PVZ", mapPointId: point },
      recipient: { lastName: arg("last") ?? "Тестов", firstName: arg("first") ?? "Тест", phone },
    },
    q.splits,
    { deliverySchema: cfg.deliverySchema, deliveryPriceKopecks: q.priceKopecks, priceBySku: new Map([[sku, Math.round(Number(arg("price") ?? 100) * 100)]]) },
  );
  if (!flag("yes")) {
    console.log("\nБез --yes: заказ НЕ создан. Тело v2/order/create:");
    console.log(JSON.stringify({ ...body, buyer: { ...body.buyer, phone: "…" }, recipient: { ...body.recipient, recipient_phone: "…" } }, null, 2));
    return;
  }
  const created = await client.orderCreate(body);
  console.log(`\nСОЗДАН РЕАЛЬНЫЙ заказ Ozon ${created.order_number ?? "?"}; отправления: ${(created.postings ?? []).join(", ") || "—"}`);
  console.log(`Отменить: prod-test-order.ts --cancel ${created.order_number ?? "<номер>"}`);
}

main()
  .catch((err) => {
    const msg = err instanceof OzonError || err instanceof Error ? err.message : String(err);
    console.error(`${msg}${lastErrorText ? `\nответ Ozon: ${lastErrorText}` : ""}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
