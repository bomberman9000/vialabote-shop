import type { Prisma } from "@prisma/client";
import type { AdminActor } from "./actor";

// Централизованная сериализация — единственное место, где before/after
// превращаются в строку для AuditLog. Вызывается ВНУТРИ той же транзакции,
// что и сама мутация: если запись аудита не удалась, вся транзакция
// откатывается — критическая write-команда не может "тихо" пройти без следа.
export async function writeAuditLog(
  tx: Prisma.TransactionClient,
  actor: AdminActor,
  params: {
    action: string;
    entityType: string;
    entityId: string;
    before: unknown;
    after: unknown;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorType: "ADMIN_USER",
      actorId: actor.userId,
      source: actor.source,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      before: params.before === undefined ? null : JSON.stringify(params.before),
      after: params.after === undefined ? null : JSON.stringify(params.after),
    },
  });
}
