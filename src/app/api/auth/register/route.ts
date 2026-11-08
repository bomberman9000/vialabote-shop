import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email(),
  password: z.string().min(6),
});

// Форма показывает error как есть, поэтому называем поле, а не «некорректные данные».
const FIELD_ERRORS: Record<string, string> = {
  name: "Укажите имя — не короче 2 символов",
  email: "Укажите корректный email",
  password: "Пароль должен быть не короче 6 символов",
};

const EMAIL_TAKEN = "Пользователь с таким email уже существует";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    return NextResponse.json({ error: FIELD_ERRORS[field] ?? "Некорректные данные" }, { status: 400 });
  }
  const { name, password } = parsed.data;
  const email = parsed.data.email.toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: EMAIL_TAKEN }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await prisma.user.create({
      data: { name, email, passwordHash },
    });
  } catch (err) {
    // Две одновременные регистрации одного email: вторая падает на unique-индексе.
    if ((err as { code?: string } | null)?.code === "P2002") {
      return NextResponse.json({ error: EMAIL_TAKEN }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}
