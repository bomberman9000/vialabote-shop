// @vitest-environment node
// Вход покупателя: authorize() провайдера credentials и колбэки jwt/session на НАСТОЯЩЕМ PostgreSQL.
// Без DATABASE_URL пропускается; в CI (ZeroHour, seeded Postgres) и локально с временной базой — запускается.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import type { CredentialsConfig } from "next-auth/providers/credentials";
import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { authOptions } from "./auth";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const email = `login-${suffix}@example.test`;

const provider = authOptions.providers[0] as CredentialsConfig;
const authorize = (credentials?: Record<string, string>) => provider.options.authorize(credentials, {} as never);

describe.skipIf(!HAS_DB)("вход по email и паролю (DB)", () => {
  let userId = "";

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: "Вера", email, passwordHash: await bcrypt.hash("secret-1", 10) },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  it("верный пароль — пользователь с ролью; email в любом регистре", async () => {
    expect(await authorize({ email: email.toUpperCase(), password: "secret-1" })).toEqual({
      id: userId,
      name: "Вера",
      email,
      role: "CUSTOMER",
    });
  });

  it("неверный пароль, чужой email и пустые поля — null", async () => {
    expect(await authorize({ email, password: "secret-2" })).toBeNull();
    expect(await authorize({ email: `nobody-${suffix}@example.test`, password: "secret-1" })).toBeNull();
    expect(await authorize({ email, password: "" })).toBeNull();
    expect(await authorize(undefined)).toBeNull();
  });

  it("id и роль доходят из токена до сессии", async () => {
    const user = await authorize({ email, password: "secret-1" });
    const token = (await authOptions.callbacks!.jwt!({ token: {}, user: user!, account: null } as never)) as JWT;
    const session = (await authOptions.callbacks!.session!({
      session: { user: { name: "Вера", email }, expires: "" },
      token,
    } as never)) as Session;

    expect(session.user).toEqual({ name: "Вера", email, id: userId, role: "CUSTOMER" });
  });
});
