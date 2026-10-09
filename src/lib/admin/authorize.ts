import { prisma } from "@/lib/prisma";
import { AdminCommandError } from "./errors";
import type { AdminActor } from "./actor";

/**
 * Роль ВСЕГДА перепроверяется здесь из БД — AdminActor несёт только userId,
 * никогда role (чтобы ни Web-сессия, ни Telegram-payload не могли заявить
 * "я админ" напрямую). Единая точка authorization для обоих источников.
 */
export async function authorizeAdmin(actor: AdminActor): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: actor.userId } });
  if (!user || user.role !== "ADMIN") {
    throw new AdminCommandError("FORBIDDEN", "Недостаточно прав для этой операции");
  }
}
