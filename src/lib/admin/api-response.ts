import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AdminCommandError } from "./errors";
import type { AdminActor } from "./actor";

// Общая обвязка для всех /api/admin/* route-хендлеров: одна и та же
// проверка сессии и один и тот же маппинг AdminCommandError -> HTTP status,
// чтобы каждый route не изобретал это заново.
export async function getWebAdminActor(): Promise<AdminActor | null> {
  const session = await getServerSession(authOptions);
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id || user.role !== "ADMIN") return null;
  return { userId: user.id, source: "WEB_ADMIN" };
}

export function adminErrorResponse(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    return NextResponse.json({ error: "VALIDATION", message: "Некорректные данные", details: err.flatten() }, {
      status: 400,
    });
  }
  if (err instanceof AdminCommandError) {
    const status =
      err.code === "FORBIDDEN"
        ? 403
        : err.code === "NOT_FOUND"
          ? 404
          : err.code === "VERSION_CONFLICT"
            ? 409
            : err.code === "MEDIA_REJECTED"
              ? 422
              : 400;
    return NextResponse.json({ error: err.code, message: err.message, details: err.details }, { status });
  }
  throw err;
}
