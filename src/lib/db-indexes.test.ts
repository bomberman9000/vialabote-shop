// @vitest-environment node
// Индексы под реальные запросы (audit-2026-11-07: к.13 — «индексов нет ни на одной модели»).
//
// Проверяем два слоя:
//   1. схема prisma/schema.prisma — нужные @@index объявлены (тест всегда выполняется);
//   2. живая PostgreSQL — индексы созданы миграцией и миграция проходит на чистой БД
//      (тест выполняется только при заданной DATABASE_URL, как остальные *.pg.test.ts).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCHEMA_PATH = path.join(REPO_ROOT, "prisma", "schema.prisma");
const PRISMA_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "prisma");

/** Модель -> поля, под которые нужен индекс. */
const REQUIRED_INDEXES: Record<string, string[][]> = {
  // Каждый платёжный вебхук ищет заказ по paymentId; без индекса — полный скан Order.
  Order: [["paymentId"], ["userId"], ["createdAt"], ["status"]],
  OrderItem: [["orderId"], ["productId"]],
  AuditLog: [["entityId"], ["createdAt"]],
  Product: [["status"], ["isActive"], ["categoryId"]],
};

/** Индексы, которые Prisma создаёт по этим полям (имя = Model_field_idx). */
const EXPECTED_INDEX_NAMES = [
  "Order_paymentId_idx",
  "Order_userId_idx",
  "Order_createdAt_idx",
  "Order_status_idx",
  "OrderItem_orderId_idx",
  "OrderItem_productId_idx",
  "AuditLog_entityId_idx",
  "AuditLog_createdAt_idx",
  "Product_status_idx",
  "Product_isActive_idx",
  "Product_categoryId_idx",
];

type Model = { name: string; body: string };

function parseModels(): Map<string, Model> {
  const raw = readFileSync(SCHEMA_PATH, "utf8");
  const models = new Map<string, Model>();
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) models.set(m[1], { name: m[1], body: m[2] });
  return models;
}

/** Все объявленные в теле модели @@index(...) и @@unique(...) — списком полей. */
function declaredLists(body: string): { kind: "index" | "unique"; fields: string[] }[] {
  const out: { kind: "index" | "unique"; fields: string[] }[] = [];
  const re = /@@(index|unique)\(\s*\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const fields = m[2]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    out.push({ kind: m[1] as "index" | "unique", fields });
  }
  return out;
}

describe("схема: индексы под реальные запросы (audit-2026-11-07: к.13)", () => {
  const models = parseModels();

  it("модели со схемы разобраны", () => {
    expect([...models.keys()]).toEqual(expect.arrayContaining(Object.keys(REQUIRED_INDEXES)));
  });

  for (const [model, fieldLists] of Object.entries(REQUIRED_INDEXES)) {
    it(`${model}: объявлены индексы ${fieldLists.map((f) => f.join(",")).join(" / ")}`, () => {
      const body = models.get(model)?.body ?? "";
      const indexes = declaredLists(body).filter((d) => d.kind === "index").map((d) => d.fields);
      for (const fields of fieldLists) {
        expect(indexes, `${model}: нет @@index([${fields.join(", ")}])`).toContainEqual(fields);
      }
    });
  }

  it("существующий @@unique([orderId, productId, reason]) не продублирован индексом", () => {
    const body = models.get("StockChangeLog")?.body ?? "";
    const declared = declaredLists(body);
    expect(declared).toContainEqual({ kind: "unique", fields: ["orderId", "productId", "reason"] });
    // Тот же набор полей не должен быть ещё и обычным индексом — это лишняя запись в индекс.
    expect(declared.filter((d) => d.kind === "index" && d.fields.join(",") === "orderId,productId,reason")).toEqual([]);
  });

  it("в одной модели нет двух одинаковых @@index", () => {
    for (const model of models.values()) {
      const seen = new Set<string>();
      for (const d of declaredLists(model.body).filter((x) => x.kind === "index")) {
        const key = d.fields.join(",");
        expect(seen.has(key), `${model.name}: дубль @@index([${key}])`).toBe(false);
        seen.add(key);
      }
    }
  });
});

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("PostgreSQL: миграция индексов применяется на чистой БД (audit-2026-11-07: к.13)", () => {
  it(
    "prisma migrate deploy на пустой базе создаёт все нужные индексы",
    async () => {
      const { PrismaClient } = await import("@prisma/client");
      const admin = new PrismaClient();
      const base = new URL(process.env.DATABASE_URL as string);
      const scratch = `vl_idx_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      const scratchUrl = new URL(base.toString());
      scratchUrl.pathname = `/${scratch}`;
      let client: InstanceType<typeof PrismaClient> | null = null;
      try {
        // Чистая база — ровно то, что получит боевая БД при первом `migrate deploy`.
        await admin.$executeRawUnsafe(`CREATE DATABASE "${scratch}"`);
        execFileSync(PRISMA_BIN, ["migrate", "deploy"], {
          cwd: REPO_ROOT,
          env: { ...process.env, DATABASE_URL: scratchUrl.toString() },
          stdio: "pipe",
          timeout: 120_000,
        });
        client = new PrismaClient({ datasources: { db: { url: scratchUrl.toString() } } });
        const rows = await client.$queryRawUnsafe<{ indexname: string }[]>(
          `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
        );
        const names = rows.map((r) => r.indexname);
        for (const expected of EXPECTED_INDEX_NAMES) {
          expect(names, `нет индекса ${expected}`).toContain(expected);
        }
      } finally {
        if (client) await client.$disconnect();
        await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`);
        await admin.$disconnect();
      }
    },
    180_000,
  );

  it(
    "в применённой базе индексы на месте (pg_indexes)",
    async () => {
      const { PrismaClient } = await import("@prisma/client");
      const client = new PrismaClient();
      try {
        const rows = await client.$queryRawUnsafe<{ indexname: string }[]>(
          `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
        );
        const names = rows.map((r) => r.indexname);
        for (const expected of EXPECTED_INDEX_NAMES) {
          expect(names, `нет индекса ${expected}`).toContain(expected);
        }
      } finally {
        await client.$disconnect();
      }
    },
    60_000,
  );
});
