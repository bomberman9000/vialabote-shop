// @vitest-environment node
// Ключ лимита по адресу клиента (audit-2026-11-07: к.11 — «rate-limiter вырожден в глобальный ключ»).
//
// Прежде ключ брался как последний адрес X-Forwarded-For, а nginx дописывает два хопа
// ($proxy_add_x_forwarded_for на edge и на VM) — ключ всегда был 127.0.0.1, и лимиты
// (60 запросов ПВЗ, 10 заказов в минуту) делил весь магазин.
import { describe, it, expect, beforeEach } from "vitest";
import {
  allowRequest,
  clientKey,
  resetRequestLimits,
  UNTRUSTED_CLIENT_KEY,
  DEFAULT_TRUSTED_PROXY_HOPS,
} from "./ozon-service";

const req = (headers: Record<string, string>) => new Request("http://localhost/x", { headers });
/** Цепочка X-Forwarded-For: слева — то, что прислал клиент, справа — адреса наших прокси. */
const xff = (chain: string) => req({ "x-forwarded-for": chain });
const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

describe("clientKey: адрес клиента для лимита (audit-2026-11-07: к.11)", () => {
  beforeEach(() => resetRequestLimits());

  it("по умолчанию два доверенных прокси (edge + VM)", () => {
    expect(DEFAULT_TRUSTED_PROXY_HOPS).toBe(2);
    // <клиент>, <edge> — клиентский адрес первым, как в бою
    expect(clientKey(xff("203.0.113.7, 127.0.0.1"))).toBe("203.0.113.7");
  });

  it("разные клиенты при одной цепочке прокси → разные ключи (проба аудита)", () => {
    // Именно эта проба аудита: раньше оба ключа были "127.0.0.1"
    expect(clientKey(xff("203.0.113.7, 127.0.0.1"))).not.toBe(clientKey(xff("198.51.100.9, 127.0.0.1")));
    expect(clientKey(xff("203.0.113.7, 127.0.0.1"))).toBe("203.0.113.7");
    expect(clientKey(xff("198.51.100.9, 127.0.0.1"))).toBe("198.51.100.9");
  });

  it("подделанная левая часть цепочки не двигает ключ", () => {
    // Клиент прислал свой X-Forwarded-For: "<подделка>" — наши прокси дописали справа
    expect(clientKey(xff("9.9.9.9, 203.0.113.7, 127.0.0.1"))).toBe("203.0.113.7");
    expect(clientKey(xff("203.0.113.7, 127.0.0.1"))).toBe("203.0.113.7");
  });

  it("TRUSTED_PROXY_HOPS переопределяет схему доверия", () => {
    expect(clientKey(xff("203.0.113.7, 127.0.0.1"), env({ TRUSTED_PROXY_HOPS: "1" }))).toBe("127.0.0.1");
    expect(clientKey(xff("203.0.113.7, 127.0.0.1, 10.0.0.5"), env({ TRUSTED_PROXY_HOPS: "3" }))).toBe("203.0.113.7");
    // мусор в настройке — дефолт, а не «доверять всему подряд»
    expect(clientKey(xff("203.0.113.7, 127.0.0.1"), env({ TRUSTED_PROXY_HOPS: "abc" }))).toBe("203.0.113.7");
    expect(clientKey(xff("203.0.113.7, 127.0.0.1"), env({ TRUSTED_PROXY_HOPS: "0" }))).toBe("203.0.113.7");
  });

  it("fail-closed: адрес из недоверенной цепочки ключом не становится", () => {
    // цепочка короче нашей схемы прокси — адрес не подтверждён, ключ общий
    expect(clientKey(xff("1.2.3.4"))).toBe(UNTRUSTED_CLIENT_KEY);
    expect(clientKey(xff("1.2.3.4"), env({ TRUSTED_PROXY_HOPS: "3" }))).toBe(UNTRUSTED_CLIENT_KEY);
    // заголовка нет вовсе
    expect(clientKey(req({}))).toBe(UNTRUSTED_CLIENT_KEY);
    // X-Real-IP не читаем: наши прокси его не ставят, клиентский доходит как есть
    expect(clientKey(req({ "x-real-ip": "198.51.100.7" }))).toBe(UNTRUSTED_CLIENT_KEY);
    // не-IP в доверенной позиции — тоже не ключ
    expect(clientKey(xff("not-an-ip, 127.0.0.1"))).toBe(UNTRUSTED_CLIENT_KEY);
  });
});

describe("allowRequest: лимит по адресу клиента (audit-2026-11-07: к.11)", () => {
  beforeEach(() => resetRequestLimits());

  it("подмена X-Forwarded-For не даёт обхода лимита", () => {
    const spoof = (left: string) =>
      req({ "x-forwarded-for": `${left}, 203.0.113.7, 127.0.0.1` }); // слева — подделка клиента
    expect(allowRequest(spoof("9.9.9.1"), "b", 2)).toBe(true);
    expect(allowRequest(spoof("9.9.9.2"), "b", 2)).toBe(true);
    expect(allowRequest(spoof("9.9.9.3"), "b", 2)).toBe(false); // тот же клиент, другой мусор слева
    expect(allowRequest(xff("203.0.113.7, 127.0.0.1"), "b", 2)).toBe(false); // и без подделки тот же счётчик
  });

  it("разные клиенты не тратят лимит друг друга", () => {
    expect(allowRequest(xff("203.0.113.7, 127.0.0.1"), "b", 1)).toBe(true);
    expect(allowRequest(xff("203.0.113.7, 127.0.0.1"), "b", 1)).toBe(false);
    expect(allowRequest(xff("198.51.100.9, 127.0.0.1"), "b", 1)).toBe(true);
  });

  it("недоверенные запросы делят один счётчик, а не свой на каждый адрес", () => {
    expect(allowRequest(xff("1.2.3.4"), "b", 1)).toBe(true);
    expect(allowRequest(xff("5.6.7.8"), "b", 1)).toBe(false); // другой адрес, тот же общий ключ
    expect(allowRequest(req({}), "b", 1)).toBe(false);
  });
});
