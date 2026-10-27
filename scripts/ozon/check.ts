// Проверка Ozon Доставки на сервере — ТОЛЬКО чтение. Заказы не создаёт и не отменяет: любой путь вне
// белого списка ниже блокируется до сети. Ключи и токены не печатаются (только имена переменных и роли).
//
// usage (на сервере, из каталога приложения, с окружением сервиса):
//   sudo bash -c 'set -a; . /etc/vialabote-shop/app.env; set +a; cd /opt/vialabote-shop/current && npx tsx scripts/ozon/check.ts [--sku 123456789] [--offer VL-001] [--qty 1]'
// Без --sku берётся первый товар сайта с заполненным ozonSku.
import { prisma } from "@/lib/prisma";
import { createOzonClient, OzonError, summarizeCheckout, type LatLong, type OzonClient } from "@/lib/delivery/ozon";
import { createTokenStore } from "@/lib/delivery/ozon-token";
import { ozonConfig } from "@/lib/delivery/ozon";
import { distanceKm } from "@/lib/delivery/ozon-service";
import { formatDeliveryDate } from "@/lib/delivery/format";

const READ_ONLY = new Set([
  "/v1/roles",
  "/v1/delivery/point/list",
  "/v1/delivery/point/info",
  "/v1/delivery/check",
  "/v2/delivery/checkout",
  "/v4/product/info/stocks",
  "/oauth/token", // обмен refresh_token на access_token — заказов не создаёт
]);

// Центры городов — только для выбора ближайшего ПВЗ в этой проверке.
const CITIES: { name: string; at: LatLong }[] = [
  { name: "Самара → Москва", at: { lat: 55.7558, long: 37.6173 } },
  { name: "Самара → Новосибирск", at: { lat: 55.0302, long: 82.9204 } },
  { name: "Самара → Самара", at: { lat: 53.1959, long: 50.1002 } },
];

// Методы, которые использует сайт: какая роль Api-Key их покрывает, видно в /v1/roles.
const BASE_METHODS = ["/v4/product/info/stocks", "/v4/posting/fbs/list", "/v3/posting/fbs/get", "/v1/returns/list"];
const OAUTH_METHODS = [
  "/v1/delivery/point/list",
  "/v1/delivery/point/info",
  "/v1/delivery/map",
  "/v1/delivery/check",
  "/v2/delivery/checkout",
  "/v2/order/create",
  "/v1/order/cancel/check",
  "/v1/order/cancel",
  "/v1/order/cancel/status",
  "/v1/cancel-reason/list-by-order",
  "/v1/posting/cancel",
];

let lastErrorText = "";
const guardedFetch: typeof fetch = async (url, init) => {
  const path = new URL(String(url)).pathname;
  if (!READ_ONLY.has(path)) throw new Error(`check.ts: путь ${path} заблокирован — скрипт только читает`);
  const res = await fetch(url, init);
  if (!res.ok) {
    // Текст ошибки Ozon (например, «Api-Key is restricted to specific IP addresses») — для диагностики.
    lastErrorText = (await res.clone().text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
  }
  return res;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function step<T>(title: string, fn: () => Promise<T>): Promise<T | null> {
  lastErrorText = "";
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof OzonError ? err.message : err instanceof Error ? err.message : String(err);
    console.log(`  ✗ ${title}: ${msg}${lastErrorText ? `\n    ответ Ozon: ${lastErrorText}` : ""}`);
    return null;
  }
}

function jwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const cfg = ozonConfig({ ...process.env, OZON_ENV: "prod" }); // проверка боевого приложения; песочница — sandbox-e2e.ts
  const vars = ["OZON_CLIENT_ID", "OZON_API_KEY", "OZON_APP_CLIENT_ID", "OZON_APP_CLIENT_SECRET", "OZON_APP_REFRESH_TOKEN", "OZON_APP_REDIRECT_URI"];
  console.log("== Окружение (значения не печатаются)");
  for (const v of vars) console.log(`  ${process.env[v]?.trim() ? "✓" : "·"} ${v}`);
  if (!cfg) {
    console.log("\nOzon Доставка выключена: нет OZON_APP_CLIENT_ID / OZON_APP_CLIENT_SECRET (частное приложение).");
    console.log("Методы доставки принимают только OAuth-токен — см. docs/ozon-delivery.md, раздел «Подключение».");
  }

  if (cfg?.apiKey || (process.env.OZON_CLIENT_ID && process.env.OZON_API_KEY)) {
    console.log("\n== Api-Key: роли и срок (/v1/roles)");
    const keyCfg = cfg ?? { ...ozonConfig({ ...process.env, OZON_ENV: "prod", OZON_APP_CLIENT_ID: "x", OZON_APP_CLIENT_SECRET: "x" })! };
    const keyClient = createOzonClient(keyCfg, { fetch: guardedFetch, getAccessToken: async () => "" });
    const roles = await step("roles", () => keyClient.roles());
    if (roles) {
      console.log(`  срок ключа до: ${roles.expires_at ?? "?"}`);
      for (const r of roles.roles ?? []) console.log(`  роль: ${r.name} (${r.methods?.length ?? 0} методов)`);
      for (const m of BASE_METHODS) {
        const by = (roles.roles ?? []).filter((r) => r.methods?.includes(m)).map((r) => r.name);
        console.log(`  ${by.length ? "✓" : "✗"} ${m}${by.length ? ` ← ${by.join(", ")}` : " — нет ни в одной роли ключа"}`);
      }
    }
  }
  if (!cfg) return;

  const tokens = createTokenStore(cfg, { prisma, fetch: guardedFetch });
  const client: OzonClient = createOzonClient(cfg, { fetch: guardedFetch, getAccessToken: (f) => tokens.getAccessToken(f) });

  console.log("\n== OAuth-токен частного приложения");
  const token = await step("токен", () => tokens.getAccessToken());
  if (!token) {
    console.log("  Нужна первичная авторизация: npx tsx scripts/ozon/oauth.ts url  →  ...  exchange <code>");
    return;
  }
  const row = await prisma.ozonOAuthToken.findUnique({ where: { id: "seller" }, select: { expiresAt: true, scope: true } });
  console.log(`  ✓ получен, действует до ${row?.expiresAt?.toISOString() ?? "?"}; scope: ${row?.scope ?? "—"}`);
  const perms = (jwtPayload(token)?.permissions as Record<string, Record<string, unknown>> | undefined)?.["seller-api"];
  if (perms) {
    for (const m of OAUTH_METHODS) console.log(`  ${m in perms ? "✓" : "✗"} ${m}`);
  } else {
    console.log("  (список методов в токене не виден — проверка по ответам ниже)");
  }

  console.log("\n== ПВЗ (/v1/delivery/point/list)");
  const list = await step("point/list", () => client.deliveryPointList());
  const all = (list?.points ?? []).filter((p) => p.coordinate).map((p) => ({ id: String(p.map_point_id), lat: p.coordinate!.lat, long: p.coordinate!.long }));
  console.log(`  всего точек: ${all.length}`);

  const sku = arg("sku");
  const product = sku
    ? null
    : await prisma.product.findFirst({ where: { ozonSku: { not: null } }, select: { title: true, ozonSku: true, ozonOfferId: true } });
  const item = { sku: Number(sku ?? product?.ozonSku), offer_id: arg("offer") ?? product?.ozonOfferId ?? undefined, quantity: Number(arg("qty") ?? 1) };
  if (!Number.isSafeInteger(item.sku) || item.sku <= 0) {
    console.log("\nНет SKU для расчёта: передайте --sku или заполните ozonSku у товара на сайте.");
    return;
  }
  console.log(`\n== Товар: sku ${item.sku}${item.offer_id ? `, offer_id ${item.offer_id}` : ""}${product ? ` («${product.title}»)` : ""}, ${item.quantity} шт.`);
  if (item.offer_id) {
    const st = await step("stocks", () => client.productStocks([item.offer_id!]));
    for (const i of st?.items ?? []) for (const s of i.stocks ?? []) console.log(`  остаток ${s.type}: present ${s.present ?? 0}, reserved ${s.reserved ?? 0}`);
  }

  for (const city of CITIES) {
    const near = all.map((p) => ({ ...p, km: distanceKm(city.at, p) })).sort((a, b) => a.km - b.km)[0];
    console.log(`\n== ${city.name}`);
    if (near) {
      const info = await step("point/info", () => client.deliveryPointInfo([near.id]));
      const m = info?.points?.[0]?.delivery_method;
      console.log(`  ПВЗ ${near.id} (${near.km.toFixed(1)} км от центра): ${m?.address ?? "?"}`);
      const res = await step("checkout ПВЗ", () =>
        client.deliveryCheckout({ delivery_schema: cfg.deliverySchema, delivery_type: { pick_up: { map_point_id: Number(near.id) } }, items: [item] }),
      );
      if (res) print("ПВЗ", summarizeCheckout(res), res.splits?.[0]?.delivery_method?.name);
    }
    const courier = await step("checkout курьер", () =>
      client.deliveryCheckout({ delivery_schema: cfg.deliverySchema, delivery_type: { courier: { coordinates: { latitude: city.at.lat, longitude: city.at.long } } }, items: [item] }),
    );
    if (courier) print("курьер", summarizeCheckout(courier), courier.splits?.[0]?.delivery_method?.name);
  }
}

function print(kind: string, s: ReturnType<typeof summarizeCheckout>, method?: string) {
  if (!s.available) {
    console.log(`  ${kind}: недоступно — ${s.reason}`);
    return;
  }
  console.log(
    `  ${kind}: ${(s.priceKopecks / 100).toFixed(2)} ₽, получение не позднее ${formatDeliveryDate(s.maxDate)} (${s.maxDate})` +
      `${method ? `, метод «${method}»` : ""}, склад ${s.splits.map((x) => x.warehouseId).join("+")}, отправлений ${s.splits.length}`,
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
