// Единая проверка «этому человеку можно писать»: включатель в коде + список владельцев + ADMIN в БД.
import { prisma } from "@/lib/prisma";
import { decideWriteAccess } from "./access";
import { isTelegramMutationsEnabled } from "./config";

export async function canWrite(telegramUserId: string): Promise<boolean> {
  if (!isTelegramMutationsEnabled()) return false; // включатель в коде + непустой TELEGRAM_ADMIN_IDS
  const user = await prisma.user.findUnique({ where: { telegramUserId } });
  return decideWriteAccess(telegramUserId, user?.role === "ADMIN");
}
