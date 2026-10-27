// Поддельный Ozon (и при необходимости Точка) для тестов: fetch, маршрутизируемый по пути URL.
// Каждый вызов записывается — тесты проверяют, сколько раз ушёл, например, /v2/order/create.
import { vi } from "vitest";
import { createOzonClient, type OzonConfig } from "../ozon";
import type { Ozon } from "../ozon-service";

export interface FakeReply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handler = (body: any, n: number) => FakeReply | Error | Promise<FakeReply | Error>;

/** Ключ — точный путь или префикс со «*» в конце. Нет обработчика -> 404. Error -> сетевой сбой. */
export function fakeFetch(routes: Record<string, Handler>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calls: { path: string; body: any; headers: Record<string, string> }[] = [];
  const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const key = path in routes ? path : Object.keys(routes).find((k) => k.endsWith("*") && path.startsWith(k.slice(0, -1)));
    const handler = key ? routes[key] : undefined;
    const reply = handler ? await handler(body, calls.filter((c) => c.path === path).length) : { status: 404, body: { code: 5 } };
    if (reply instanceof Error) throw reply;
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(reply.headers ?? {}),
      json: async () => reply.body ?? {},
      text: async () => JSON.stringify(reply.body ?? {}),
    } as unknown as Response;
  });
  return { fetch, calls, count: (path: string) => calls.filter((c) => c.path === path).length, bodies: (path: string) => calls.filter((c) => c.path === path).map((c) => c.body) };
}

export const testConfig: OzonConfig = {
  base: "https://api-seller.ozon.ru",
  oauthBase: "https://xapi.ozon.ru",
  sellerClientId: "100001",
  apiKey: "test-api-key",
  app: { clientId: "test-app", clientSecret: "test-secret" },
  deliverySchema: "FBS",
  rps: 50,
};

/** Ozon для прямых вызовов сервиса: без БД-токена и без пауз. */
export function testOzon(fake: ReturnType<typeof fakeFetch>, cfg: Partial<OzonConfig> = {}): Ozon {
  const full = { ...testConfig, ...cfg };
  return {
    cfg: full,
    client: createOzonClient(full, { fetch: fake.fetch as unknown as typeof fetch, sleep: async () => {}, getAccessToken: async () => "test-token" }),
    exchangeCode: async () => ({ expiresIn: 3600, scope: null }),
  };
}

/** Успешный ответ v2/delivery/checkout: одно отправление со всеми позициями. */
export function checkoutReply(
  items: { sku: number; quantity: number; offer_id?: string }[],
  { amount = "250.00", to = "2026-11-05T21:00:00Z", type = "PVZ" }: { amount?: string; to?: string; type?: string } = {},
): FakeReply {
  return {
    body: {
      splits: [
        {
          commissions: { total: { amount, currency: "RUB" } },
          delivery_method: {
            id: 501,
            name: "Ozon ПВЗ",
            delivery_type: type,
            timeslots: [
              { timeslot_id: 9001, client_date_range: { from: "2026-11-02T06:00:00Z", to }, logistic_date_range: { from: "2026-11-01T00:00:00Z", to: "2026-11-04T00:00:00Z" } },
            ],
          },
          delivery_schema: "FBS",
          items,
          warehouse_id: 777,
        },
      ],
    },
  };
}

export const unavailableReply = (reason: string): FakeReply => ({ body: { splits: [{ commissions: null, unavailable_reason: reason, items: [] }] } });

export const stocksReply = (rows: { offer_id: string; present: number; reserved?: number }[]): FakeReply => ({
  body: { items: rows.map((r) => ({ offer_id: r.offer_id, stocks: [{ type: "fbs", present: r.present, reserved: r.reserved ?? 0, sku: 1 }] })) },
});
