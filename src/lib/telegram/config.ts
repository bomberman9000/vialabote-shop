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
