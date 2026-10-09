import { NextResponse } from "next/server";
import { isTelegramConfigured, getTelegramWebhookSecret } from "@/lib/telegram/config";
import { prepareCommand, executeConfirmation, declineConfirmation } from "@/lib/telegram/dispatch-command";
import { isTelegramAdmin } from "@/lib/telegram/actor-resolver";
import { helpText, isMenuCommand, menuScreen, parseCallback, renderScreen, cb } from "@/lib/telegram/panel";

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

// chat.type: "private" | "group" | "supergroup" | "channel". Панель работает
// только в личном чате: в группе бот молчит (не раскрывает данные участникам).
interface TelegramChat {
  id: number;
  type?: string;
}

interface TelegramMessage {
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: { chat: TelegramChat; message_id: number };
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

const UNLINKED_TEXT = "Этот Telegram-аккаунт не привязан к администратору Vialabote.";

function isPrivate(chat: TelegramChat | undefined): boolean {
  return !chat?.type || chat.type === "private";
}

async function handleMessage(message: TelegramMessage) {
  const telegramUserId = String(message.from!.id);
  const chatId = message.chat.id;

  if (!isPrivate(message.chat)) {
    return NextResponse.json({ ok: true });
  }

  const menu = isMenuCommand(message.text!);
  if (menu) {
    if (!(await isTelegramAdmin(telegramUserId))) {
      return NextResponse.json({ method: "sendMessage", chat_id: chatId, text: UNLINKED_TEXT });
    }
    const screen = menuScreen();
    return NextResponse.json({
      method: "sendMessage",
      chat_id: chatId,
      text: menu === "help" ? helpText() : screen.text,
      reply_markup: menu === "help" ? { inline_keyboard: [[{ text: "📋 Меню", callback_data: cb("menu") }]] } : { inline_keyboard: screen.keyboard },
    });
  }

  const result = await prepareCommand(telegramUserId, message.text!.trim());

  switch (result.kind) {
    case "not_authorized":
      return NextResponse.json({
        method: "sendMessage",
        chat_id: chatId,
        text: UNLINKED_TEXT,
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

async function handleCallbackQuery(query: TelegramCallbackQuery) {
  const telegramUserId = String(query.from.id);
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;
  const data = query.data ?? "";

  if (!isPrivate(query.message?.chat)) {
    return NextResponse.json({ method: "answerCallbackQuery", callback_query_id: query.id });
  }

  // Telegram CMS V2 panel: read-only screens, ADMIN by Telegram user id only.
  if (data.startsWith("v2:")) {
    if (!(await isTelegramAdmin(telegramUserId))) {
      return NextResponse.json({ method: "answerCallbackQuery", callback_query_id: query.id, text: "Нет доступа", show_alert: true });
    }
    const target = parseCallback(data);
    if (!target || chatId === undefined || messageId === undefined) {
      return NextResponse.json({ method: "answerCallbackQuery", callback_query_id: query.id, text: "Кнопка устарела — откройте /menu" });
    }
    const screen = await renderScreen(target.screen, target.page);
    return NextResponse.json({
      method: "editMessageText",
      chat_id: chatId,
      message_id: messageId,
      text: screen.text,
      reply_markup: { inline_keyboard: screen.keyboard },
    });
  }

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
