import { isAdminListConfigured, type EnvLike } from "./access";

// Config-gate для Telegram-транспорта. Owner decision: без настоящего
// BotFather-токена приложение НЕ должно пытаться поднять webhook и НЕ
// должно падать. Admin Control Plane обязан полностью работать через Web
// Admin независимо от того, настроен Telegram или нет.
//
// SECURITY: токен и secret ОБЯЗАТЕЛЬНЫ вместе. Telegram webhook — это
// публичный HTTP endpoint без встроенной аутентификации; единственное, что
// доказывает, что запрос пришёл от Telegram (а не от произвольного
// анонимного POST с подделанным from.id), — совпадение заголовка
// x-telegram-bot-api-secret-token с настроенным секретом (см.
// https://core.telegram.org/bots/api#setwebhook, secret_token). Если бы
// секрет был опциональным, деплой с токеном, но без секрета, превращал бы
// весь Admin Control Plane (цены, скидки, publish/archive) в
// неаутентифицированный write API — поэтому "настроено" значит "оба поля
// заданы", а не только токен.
export function isTelegramConfigured(): boolean {
  return Boolean(
    process.env.TELEGRAM_BOT_TOKEN &&
      process.env.TELEGRAM_BOT_TOKEN.trim().length > 0 &&
      process.env.TELEGRAM_WEBHOOK_SECRET &&
      process.env.TELEGRAM_WEBHOOK_SECRET.trim().length > 0,
  );
}

// ЗАПИСЬ ЧЕРЕЗ TELEGRAM — ЯВНОЕ РЕШЕНИЕ ВЛАДЕЛЬЦА, ПРИНЯТОЕ В КОДЕ.
//
// История: V2 (2026-10-09) был «read-only by code»: функция всегда возвращала false, а
// переменная TELEGRAM_CMS_MUTATIONS ничего не включала. Владелец (2026-10-27) попросил
// редактирование остатков и карточек из бота, поэтому ниже включатель переведён в true.
//
// Запись происходит ТОЛЬКО если одновременно выполнено всё:
//   1. эта константа равна true (вернуть read-only = поставить false и выпустить релиз);
//   2. TELEGRAM_ADMIN_IDS не пуст — при пустом списке запись выключена, что бы ни стояло
//      в остальных переменных (TELEGRAM_CMS_MUTATIONS по-прежнему игнорируется);
//   3. id отправителя есть в TELEGRAM_ADMIN_IDS и привязан к ADMIN в БД (access.ts);
//   4. изменение подтверждено кнопкой «Подтвердить» после предварительного просмотра.
export const TELEGRAM_WRITES_ENABLED_IN_CODE = true;

export function isTelegramMutationsEnabled(env: EnvLike = process.env): boolean {
  return TELEGRAM_WRITES_ENABLED_IN_CODE && isAdminListConfigured(env);
}

export const TELEGRAM_MUTATIONS_DISABLED_MESSAGE =
  "Изменения через Telegram сейчас отключены (режим только чтения): не задан список владельцев " +
  "TELEGRAM_ADMIN_IDS. Просмотр работает, правки — через Web Admin.";

export function getTelegramBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN не настроен — вызывающий код обязан проверить isTelegramConfigured() раньше");
  }
  return token;
}

/** Вызывать ТОЛЬКО после isTelegramConfigured() === true — тогда секрет гарантированно задан. */
export function getTelegramWebhookSecret(): string {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET не настроен — вызывающий код обязан проверить isTelegramConfigured() раньше");
  }
  return secret;
}
