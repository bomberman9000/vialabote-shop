// Иммутабельный числовой Telegram user id -> внутренний User. НИКОГДА не по
// username (owner decision — username можно сменить/угнать, id — нет).
import { prisma } from "@/lib/prisma";
import type { AdminActor } from "@/lib/admin/actor";

export interface ResolvedTelegramActor {
  userId: string;
  role: string;
}

export async function resolveTelegramActor(telegramUserId: string): Promise<ResolvedTelegramActor | null> {
  const user = await prisma.user.findUnique({ where: { telegramUserId } });
  if (!user) return null;
  return { userId: user.id, role: user.role };
}

export function toAdminActor(resolved: ResolvedTelegramActor): AdminActor {
  return { userId: resolved.userId, source: "TELEGRAM" };
}
