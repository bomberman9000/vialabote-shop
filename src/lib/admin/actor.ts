export type CommandSource = "WEB_ADMIN" | "TELEGRAM";

// Единый "кто выполняет команду" — Web Admin получает это из NextAuth-сессии,
// Telegram получает из подтверждённого PendingConfirmation. Ни один command
// не принимает userId/role напрямую из клиентского payload.
export interface AdminActor {
  userId: string;
  source: CommandSource;
}
