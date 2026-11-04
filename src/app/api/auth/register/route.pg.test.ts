// @vitest-environment node
// Регистрация покупателя на НАСТОЯЩЕМ PostgreSQL (unique-индекс email, гонка двух запросов).
// Без DATABASE_URL пропускается; в CI (ZeroHour, seeded Postgres) и локально с временной базой — запускается.
import { describe, it, expect, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const email = (tag: string) => `reg-${tag}-${suffix}@example.test`;

function req(body: unknown) {
  return new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function call(body: unknown) {
  const res = await POST(req(body));
  return { status: res.status, body: await res.json() };
}

describe.skipIf(!HAS_DB)("POST /api/auth/register (DB)", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${suffix}@example.test` } } });
    await prisma.$disconnect();
  });

  it("создаёт покупателя: email в нижнем регистре, пароль — bcrypt, роль CUSTOMER", async () => {
    const res = await call({ name: "  Анна  ", email: `  ${email("ok").toUpperCase()} `, password: "secret-1" });

    expect(res).toEqual({ status: 200, body: { ok: true } });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: email("ok") } });
    expect(user.name).toBe("Анна");
    expect(user.role).toBe("CUSTOMER");
    expect(user.passwordHash).not.toBe("secret-1");
    expect(await bcrypt.compare("secret-1", user.passwordHash)).toBe(true);
  });

  it("тот же email в другом регистре — 409", async () => {
    await call({ name: "Анна", email: email("dup"), password: "secret-1" });

    const res = await call({ name: "Анна", email: email("dup").toUpperCase(), password: "secret-2" });

    expect(res).toEqual({ status: 409, body: { error: "Пользователь с таким email уже существует" } });
  });

  it("две одновременные регистрации одного email: одна 200, вторая 409, а не 500", async () => {
    const body = { name: "Гонка", email: email("race"), password: "secret-1" };

    const statuses = (await Promise.all([call(body), call(body), call(body)])).map((r) => r.status).sort();

    expect(statuses).toEqual([200, 409, 409]);
    expect(await prisma.user.count({ where: { email: email("race") } })).toBe(1);
  });

  it("ошибка валидации называет поле", async () => {
    expect(await call({ name: "Я", email: email("v1"), password: "secret-1" })).toEqual({
      status: 400,
      body: { error: "Укажите имя — не короче 2 символов" },
    });
    expect(await call({ name: "Анна", email: "not-an-email", password: "secret-1" })).toEqual({
      status: 400,
      body: { error: "Укажите корректный email" },
    });
    expect(await call({ name: "Анна", email: email("v2"), password: "12345" })).toEqual({
      status: 400,
      body: { error: "Пароль должен быть не короче 6 символов" },
    });
    expect(await prisma.user.count({ where: { email: { in: [email("v1"), email("v2")] } } })).toBe(0);
  });

  it("битый JSON — 400, а не 500", async () => {
    expect(await call("{oops")).toEqual({ status: 400, body: { error: "Некорректные данные" } });
  });
});
