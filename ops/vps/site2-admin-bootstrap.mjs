// SITE_2 (vialabote-shop) — create/update the first production ADMIN and link
// the owner's numeric Telegram user id. Called by site2-admin-bootstrap.sh.
//
// Input: exactly three lines on STDIN — email, password, telegram user id.
// The password never appears in argv, env, stdout, stderr or files.
// Env: APP_DIR (release with node_modules), DATABASE_URL (SITE_2 app role),
//      EXPECT_DB (vialabote_shop), EXPECT_PORT (5433).
// Output: one JSON line without secrets. Exit 0 ok, 2 validation, 3 guard/conflict.
import { createRequire } from "node:module";
import path from "node:path";

const APP_DIR = process.env.APP_DIR;
if (!APP_DIR) { console.error("APP_DIR not set"); process.exit(2); }
const require = createRequire(path.join(APP_DIR, "package.json"));
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const fail = (code, msg) => { console.error(`ABORT: ${msg}`); process.exit(code); };

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const lines = Buffer.concat(chunks).toString("utf8").split("\n");
const email = (lines[0] ?? "").trim().toLowerCase();
const password = lines[1] ?? "";
const telegramUserId = (lines[2] ?? "").trim();
chunks.length = 0; lines.length = 0;

// Validation (also done in the shell wrapper — defence in depth).
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) fail(2, "invalid email");
if (password.length < 12 || password.length > 200) fail(2, "password must be 12..200 characters");
if (password.toLowerCase() === email) fail(2, "password must not equal the email");
if (!/^[1-9][0-9]{4,14}$/.test(telegramUserId)) fail(2, "telegram user id must be a positive number (5-15 digits)");

const prisma = new PrismaClient();
try {
  // Wrong-DB guard: we must be connected to the SITE_2 database itself.
  const [where] = await prisma.$queryRaw`select current_database() as db, inet_server_port() as port, current_user as role`;
  if (where.db !== process.env.EXPECT_DB || String(where.port) !== process.env.EXPECT_PORT) {
    fail(3, `connected to ${where.db}:${where.port}, expected ${process.env.EXPECT_DB}:${process.env.EXPECT_PORT} — nothing written`);
  }

  const passwordHash = await bcrypt.hash(password, 10); // same as /api/auth/register and prisma/seed.ts

  const result = await prisma.$transaction(async (tx) => {
    const byTelegram = await tx.user.findUnique({ where: { telegramUserId } });
    if (byTelegram && byTelegram.email !== email) {
      return { conflict: `telegram id is already linked to another user (${byTelegram.email})` };
    }
    const existing = await tx.user.findUnique({ where: { email } });
    if (existing?.telegramUserId && existing.telegramUserId !== telegramUserId) {
      return { conflict: "this user is already linked to a different telegram id — not overwriting" };
    }
    const user = existing
      ? await tx.user.update({ where: { id: existing.id }, data: { role: "ADMIN", telegramUserId, passwordHash } })
      : await tx.user.create({ data: { email, name: "Администратор", role: "ADMIN", telegramUserId, passwordHash } });
    return { action: existing ? "updated" : "created", user };
  });
  if (result.conflict) fail(3, `${result.conflict} — nothing written`);

  const u = result.user;
  const hashOk = await bcrypt.compare(password, u.passwordHash);
  const admins = await prisma.user.count({ where: { role: "ADMIN" } });
  const users = await prisma.user.count();
  console.log(JSON.stringify({
    action: result.action,
    email: u.email,
    role: u.role,
    telegramLinked: u.telegramUserId === telegramUserId,
    passwordHashPresent: /^\$2[aby]\$10\$/.test(u.passwordHash),
    passwordHashVerifies: hashOk,
    adminUsers: admins,
    totalUsers: users,
    db: `${where.db}:${where.port}`,
  }));
} finally {
  await prisma.$disconnect();
}
