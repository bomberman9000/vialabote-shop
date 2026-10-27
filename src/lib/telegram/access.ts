// Доступ к Telegram-панели: только владелец, по числовому Telegram user id из переменной
// окружения TELEGRAM_ADMIN_IDS (id через запятую или пробел). Username не используется:
// его можно сменить, id — нет. Функции чистые (env передаётся параметром) — тестируются без БД.
//
// Политика:
//  - список задан  -> ТОЛЬКО id из списка видят панель; роль в БД одного доступа не даёт;
//  - список пуст   -> запись выключена полностью, а чтение работает как в V2
//                     (ADMIN в БД, привязанный по telegramUserId) — см. isPanelReader().
import { prisma } from "@/lib/prisma";

export type EnvLike = Record<string, string | undefined>;

/** "123, 456 789" -> ["123","456","789"]; мусор, не-числа и дубликаты отбрасываются. */
export function parseAdminIds(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const ids = raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d{1,20}$/.test(s));
  return Array.from(new Set(ids));
}

export function getAdminIds(env: EnvLike = process.env): string[] {
  return parseAdminIds(env.TELEGRAM_ADMIN_IDS);
}

export function isAdminListConfigured(env: EnvLike = process.env): boolean {
  return getAdminIds(env).length > 0;
}

/** Есть ли числовой id в списке владельцев. При пустом списке — всегда false. */
export function isInAdminList(telegramUserId: string | number, env: EnvLike = process.env): boolean {
  return getAdminIds(env).includes(String(telegramUserId));
}

/**
 * Может ли id ВИДЕТЬ панель (чтение). Список задан -> только список. Список пуст ->
 * прежнее правило V2: ADMIN в БД с этим telegramUserId (`dbIsAdmin` считает вызывающий).
 */
export function decideReadAccess(telegramUserId: string | number, dbIsAdmin: boolean, env: EnvLike = process.env): boolean {
  if (isAdminListConfigured(env)) return isInAdminList(telegramUserId, env);
  return dbIsAdmin;
}

/** Запись: список обязан быть задан, id в нём, и аккаунт привязан к ADMIN в БД (нужен для журнала). */
export function decideWriteAccess(telegramUserId: string | number, dbIsAdmin: boolean, env: EnvLike = process.env): boolean {
  return isAdminListConfigured(env) && isInAdminList(telegramUserId, env) && dbIsAdmin;
}

async function dbIsAdmin(telegramUserId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { telegramUserId } });
  return user?.role === "ADMIN";
}

/** Видит ли пользователь панель (кнопки, экраны, текстовые команды). */
export async function isPanelReader(telegramUserId: string): Promise<boolean> {
  if (isAdminListConfigured()) return isInAdminList(telegramUserId); // без обращения к БД
  return dbIsAdmin(telegramUserId);
}
