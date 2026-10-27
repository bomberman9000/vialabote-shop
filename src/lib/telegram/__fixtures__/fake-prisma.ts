// Минимальная in-memory подмена Prisma для тестов маршрута без PostgreSQL.
// Реализует ровно те вызовы, которые делают панель, подтверждения и команды остатков/карточек.
// Это НЕ эмуляция Prisma целиком: неизвестный where-ключ -> исключение, чтобы тест не врал молча.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function matchValue(v: any, cond: any): boolean {
  if (cond === null || typeof cond !== "object" || cond instanceof Date) {
    return cond instanceof Date ? v?.getTime() === cond.getTime() : v === cond;
  }
  for (const [op, arg] of Object.entries(cond)) {
    if (op === "not") { if (arg === null ? v === null || v === undefined : v === arg) return false; }
    else if (op === "in") { if (!(arg as any[]).includes(v)) return false; }
    else if (op === "gt") { if (!(v > (arg as any))) return false; }
    else if (op === "gte") { if (!(v >= (arg as any))) return false; }
    else if (op === "lt") { if (!(v < (arg as any))) return false; }
    else if (op === "lte") { if (!(v <= (arg as any))) return false; }
    else throw new Error(`fake-prisma: unsupported operator ${op}`);
  }
  return true;
}

function match(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (cond === null) return row[k] === null || row[k] === undefined;
    return matchValue(row[k], cond);
  });
}

function select(row: Row, sel: Row | undefined, model: Model): Row {
  if (!sel) return { ...row };
  const out: Row = {};
  for (const [k, v] of Object.entries(sel)) {
    if (!v) continue;
    if (k === "_count") out._count = { items: model.db.orderItem.rows.filter((i) => i.orderId === row.id).length };
    else if (k === "items") out.items = model.db.orderItem.rows.filter((i) => i.orderId === row.id).map((i) => select(i, (v as any).select, model));
    else if (k === "media") out.media = [];
    else out[k] = row[k];
  }
  return out;
}

function sortRows(rows: Row[], orderBy: any): Row[] {
  const keys: Row[] = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  return [...rows].sort((a, b) => {
    for (const o of keys) {
      const [k, dir] = Object.entries(o)[0] as [string, string];
      const av = a[k], bv = b[k];
      const c = av < bv ? -1 : av > bv ? 1 : 0;
      if (c) return dir === "desc" ? -c : c;
    }
    return 0;
  });
}

let seq = 0;
class Model {
  rows: Row[] = [];
  constructor(
    public db: FakeDb,
    private defaults: () => Row = () => ({}),
    /** составные unique-индексы; как в PostgreSQL, строки с NULL в индексе не конфликтуют */
    private uniques: string[][] = [],
  ) {}
  async findUnique({ where, select: sel }: any) {
    const r = this.rows.find((x) => match(x, where));
    return r ? select(r, sel, this) : null;
  }
  async findUniqueOrThrow(args: any) {
    const r = await this.findUnique(args);
    if (!r) throw new Error("fake-prisma: not found");
    return r;
  }
  async findFirst({ where, orderBy, select: sel }: any = {}) {
    const r = sortRows(this.rows.filter((x) => match(x, where)), orderBy)[0];
    return r ? select(r, sel, this) : null;
  }
  async findMany({ where, orderBy, skip = 0, take, select: sel }: any = {}) {
    const rows = sortRows(this.rows.filter((x) => match(x, where)), orderBy);
    return rows.slice(skip, take === undefined ? undefined : skip + take).map((r) => select(r, sel, this));
  }
  async count({ where }: any = {}) {
    return this.rows.filter((x) => match(x, where)).length;
  }
  async create({ data }: any) {
    const row = { id: `id${++seq}`, createdAt: new Date(), ...this.defaults(), ...data };
    for (const fields of this.uniques) {
      if (fields.some((f) => row[f] === null || row[f] === undefined)) continue;
      if (this.rows.some((r) => fields.every((f) => r[f] === row[f]))) {
        throw Object.assign(new Error(`Unique constraint failed on the fields: (${fields.join(",")})`), {
          code: "P2002",
          meta: { target: fields },
        });
      }
    }
    this.rows.push(row);
    return { ...row };
  }
  async updateMany({ where, data }: any) {
    const hit = this.rows.filter((x) => match(x, where));
    for (const r of hit) {
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === "object" && "increment" in (v as any)) r[k] += (v as any).increment;
        else if (v && typeof v === "object" && "decrement" in (v as any)) r[k] -= (v as any).decrement;
        else r[k] = v;
      }
    }
    return { count: hit.length };
  }
  async update({ where, data }: any) {
    await this.updateMany({ where, data });
    return this.findUnique({ where });
  }
  async groupBy({ by, where }: any) {
    const groups = new Map<string, number>();
    for (const r of this.rows.filter((x) => match(x, where))) groups.set(r[by[0]], (groups.get(r[by[0]]) ?? 0) + 1);
    return Array.from(groups, ([k, n]) => ({ [by[0]]: k, _count: { _all: n } }));
  }
  async aggregate({ where, _sum }: any) {
    const rows = this.rows.filter((x) => match(x, where));
    const sum: Row = {};
    for (const k of Object.keys(_sum ?? {})) sum[k] = rows.reduce((a, r) => a + r[k], 0);
    return { _sum: sum, _count: { _all: rows.length } };
  }
}

export class FakeDb {
  user = new Model(this);
  product = new Model(this, () => ({ version: 1, stock: 0, status: "draft", oldPrice: null, activeIngredients: null, description: "" }));
  order = new Model(this);
  orderItem = new Model(this);
  pendingConfirmation = new Model(this, () => ({ consumedAt: null }));
  stockChangeLog = new Model(this, () => ({ reason: "ADJUST", orderId: null }), [["orderId", "productId", "reason"]]);
  auditLog = new Model(this);
  mediaAsset = new Model(this);
  discount = new Model(this);
  /** журнал вызовов: "lock:<orderId>" и "read:<model>" — тесты проверяют порядок блокировки */
  calls: string[] = [];

  /**
   * Поддерживается ровно один сырой запрос — блокировка заказа в movements.lockOrder:
   * SELECT "id" FROM "Order" WHERE "id" = $1 FOR UPDATE. Остальное -> исключение.
   */
  async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
    const sql = strings.join("$");
    if (!/FROM "Order" WHERE "id" = \$ FOR UPDATE/.test(sql)) throw new Error(`fake-prisma: unsupported raw SQL: ${sql}`);
    this.calls.push(`lock:${String(values[0])}`);
    return this.order.rows.filter((o) => o.id === values[0]).map((o) => ({ id: o.id }));
  }

  private queue: Promise<unknown> = Promise.resolve();
  private models(): Model[] {
    return Object.values(this).filter((v): v is Model => v instanceof Model);
  }
  /**
   * Транзакции выполняются по очереди (как PostgreSQL при блокировке одной и той же строки товара)
   * и откатываются целиком при исключении: снимок всех таблиц восстанавливается.
   */
  async $transaction<T>(fn: (tx: FakeDb) => Promise<T>): Promise<T> {
    const run = async () => {
      const snapshot = this.models().map((m) => m.rows.map((r) => ({ ...r })));
      try {
        return await fn(this);
      } catch (err) {
        this.models().forEach((m, i) => {
          m.rows.length = 0;
          m.rows.push(...snapshot[i]);
        });
        throw err;
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
