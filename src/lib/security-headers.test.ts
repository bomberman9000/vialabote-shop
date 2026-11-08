// Проверка security-заголовков из next.config.js (audit-2026-11-07: к.40).
// Тест работает с самой конфигурацией Next.js — без HTTP-запроса: проверяем
// секцию headers() (source "/:path*") и точные значения заголовков, которые
// сервер отдаст на любой маршрут.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

interface HeaderField {
  key: string;
  value: string;
}

interface HeaderRule {
  source: string;
  headers: HeaderField[];
}

interface NextConfigLike {
  headers?: () => HeaderRule[] | Promise<HeaderRule[]>;
}

const requireConfig = createRequire(path.join(process.cwd(), "package.json"));

/** Корень репозитория: поднимаемся от рабочей директории до next.config.js. */
function findConfigPath(): string {
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, "next.config.js");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("next.config.js не найден");
    dir = parent;
  }
}

const config = requireConfig(findConfigPath()) as NextConfigLike;

async function ruleForAllRoutes(): Promise<HeaderRule> {
  const fn = config.headers;
  if (typeof fn !== "function") throw new Error("next.config.js: нет секции headers()");
  const rules = await fn();
  const rule = rules.find((r) => r.source === "/:path*");
  if (!rule) throw new Error('next.config.js: нет правила headers() для source "/:path*"');
  return rule;
}

async function headerMap(): Promise<Map<string, string>> {
  const rule = await ruleForAllRoutes();
  return new Map(rule.headers.map((h) => [h.key, h.value]));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("security headers (next.config.js)", () => {
  it("одно правило на все маршруты", async () => {
    const rule = await ruleForAllRoutes();
    expect(rule.source).toBe("/:path*");
  });

  it("HSTS, nosniff, frame, referrer и permissions — точные значения", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const headers = await headerMap();
    expect(headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toBe("geolocation=(), microphone=(), camera=()");
  });

  it("CSP строгий: default-src 'self', без unsafe-eval, object-src 'none'", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const csp = (await headerMap()).get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("внешние источники в CSP — ровно те, что грузит фронтенд из кода", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const csp = (await headerMap()).get("Content-Security-Policy") ?? "";
    // Метрика (cookie-banner.tsx), CSS шрифта (globals.css), файлы шрифта.
    const origins = [...new Set([...csp.matchAll(/https:\/\/[a-z0-9.-]+/g)].map((m) => m[0]))].sort();
    expect(origins).toEqual(["https://fonts.googleapis.com", "https://fonts.gstatic.com", "https://mc.yandex.ru"]);
  });

  it("'unsafe-eval' разрешён только в development (webpack/HMR), в production — нет", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const dev = (await headerMap()).get("Content-Security-Policy") ?? "";
    expect(dev).toContain("'unsafe-eval'");

    vi.stubEnv("NODE_ENV", "production");
    const prod = (await headerMap()).get("Content-Security-Policy") ?? "";
    expect(prod).not.toContain("'unsafe-eval'");
    // В production HSTS обязателен, в dev его нет (иначе localhost уходит в https).
    expect((await headerMap()).get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
  });
});
