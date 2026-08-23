import { NextResponse } from "next/server";
import { isTelegramConfigured, getTelegramWebhookSecret } from "@/lib/telegram/config";
import { prepareCommand, executeConfirmation, declineConfirmation } from "@/lib/telegram/dispatch-command";

// Config-gated: без TELEGRAM_BOT_TOKEN этот route существует, но ничего не
// делает — 404 на любой запрос, без обращения к БД/парсеру/командам. Так
// приложение никогда не "пытается поднять webhook" и не падает без токена
// (owner decision).
//
// Ответ Telegram отправляется ЧЕРЕЗ САМ HTTP-ответ на webhook (метод
// sendMessage/editMessageText в теле JSON-ответа) — Telegram Bot API
// поддерживает это нативно. Это осознанно избавляет от необходимости
// делать исходящий HTTP-вызов к api.telegram.org из этого кода: реальное
// исходящее подключение к внешнему сервису — отдельная задача, требующая
// нового разрешения (owner decision), а не техническая необходимость.

interface TelegramUser {
  id: number;
}

interface TelegramMessage {
  chat: { id: number };
  from?: TelegramUser;
  text?: string;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: { chat: { id: number }; message_id: number };
  data?: string;
}

interface TelegramUpdate {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

function inlineKeyboard(confirmationId: string) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Подтвердить", callback_data: `confirm:${confirmationId}` },
        { text: "✖️ Отмена", callback_data: `cancel:${confirmationId}` },
      ],
    ],
  };
}

export async function POST(req: Request) {
  if (!isTelegramConfigured()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // isTelegramConfigured() уже гарантирует, что секрет задан — проверка
  // здесь ВСЕГДА обязательна, никакого "если секрет настроен" обхода:
  // без совпадения секрета запрос не может быть отличён от произвольного
  // анонимного POST с подделанным from.id (см. комментарий в config.ts).
  const secret = getTelegramWebhookSecret();
  const provided = req.headers.get("x-telegram-bot-api-secret-token");
  if (provided !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  if (update.callback_query) {
    return handleCallbackQuery(update.callback_query);
  }
  if (update.message?.text && update.message.from) {
    return handleMessage(update.message);
  }

  return NextResponse.json({ ok: true });
}

async function handleMessage(message: TelegramMessage) {
  const telegramUserId = String(message.from!.id);
  const chatId = message.chat.id;

  const result = await prepareCommand(telegramUserId, message.text!.trim());

  switch (result.kind) {
    case "not_authorized":
      return NextResponse.json({
        method: "sendMessage",
        chat_id: chatId,
        text: "Этот Telegram-аккаунт не привязан к администратору Vialabote.",
      });
    case "unknown_command":
      return NextResponse.json({
        method: "sendMessage",
        chat_id: chatId,
        text: "Команда не распознана. Проверьте формат (см. /help).",
      });
    case "ambiguous_command":
      return NextResponse.json({
        method: "sendMessage",
        chat_id: chatId,
        text: `Не удалось однозначно распознать команду: ${result.reason}. Уточните формулировку.`,
      });
    case "entity_not_found":
      return NextResponse.json({
        method: "sendMessage",
        chat_id: chatId,
        text: `Товар «${result.query}» не найден.`,
      });
    case "entity_ambiguous":
      return NextResponse.json({
        method: "sendMessage",
        chat_id: chatId,
        text: `Нашлось несколько товаров, уточните:\n${result.candidates.map((c) => `• ${c.title}`).join("\n")}`,
      });
    case "unsupported":
      return NextResponse.json({ method: "sendMessage", chat_id: chatId, text: result.message });
    case "immediate_result":
      return NextResponse.json({ method: "sendMessage", chat_id: chatId, text: result.text });
    case "confirmation_required":
      return NextResponse.json({
        method: "sendMessage",
        chat_id: chatId,
        text: result.previewText,
        reply_markup: inlineKeyboard(result.confirmationId),
      });
  }
}

async function handleCallbackQuery(cb: TelegramCallbackQuery) {
  const telegramUserId = String(cb.from.id);
  const chatId = cb.message?.chat.id;
  const messageId = cb.message?.message_id;
  const data = cb.data ?? "";

  const [action, confirmationId] = data.split(":");
  if (!confirmationId || (action !== "confirm" && action !== "cancel")) {
    return NextResponse.json({ ok: true });
  }

  if (action === "cancel") {
    try {
      await declineConfirmation(telegramUserId, confirmationId);
      return NextResponse.json({
        method: "editMessageText",
        chat_id: chatId,
        message_id: messageId,
        text: "Отменено.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось отменить";
      return NextResponse.json({ method: "sendMessage", chat_id: chatId, text: message });
    }
  }

  const outcome = await executeConfirmation(telegramUserId, confirmationId);
  return NextResponse.json({
    method: "editMessageText",
    chat_id: chatId,
    message_id: messageId,
    text: outcome.message,
  });
}
