import { NextResponse } from "next/server";
import { isTelegramConfigured, getTelegramWebhookSecret } from "@/lib/telegram/config";
import { prepareCommand, executeConfirmation, declineConfirmation } from "@/lib/telegram/dispatch-command";
import { isPanelReader } from "@/lib/telegram/access";
import { canWrite } from "@/lib/telegram/write-guard";
import { helpText, isMenuCommand, menuScreen, parseCallback, renderScreen, cb } from "@/lib/telegram/panel";
import { parseAction } from "@/lib/telegram/callbacks";
import { handleAction, confirmKeyboard } from "@/lib/telegram/panel-actions";
import { handleInputMessage, type IncomingFile, type InputReply } from "@/lib/telegram/input-handler";
import { cancelInputs } from "@/lib/telegram/input-session";

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
  // фото приходит набором размеров (последний — самый большой); «как файл» — document
  photo?: { file_id: string; width: number; height: number; file_size?: number }[];
  document?: { file_id: string; mime_type?: string; file_size?: number };
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: { chat: TelegramChat; message_id: number; photo?: unknown[] };
  data?: string;
}

interface TelegramUpdate {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

function inlineKeyboard(confirmationId: string) {
  return { inline_keyboard: confirmKeyboard(confirmationId) };
}

const MENU_MARKUP = { inline_keyboard: [[{ text: "📋 Меню", callback_data: cb("menu") }]] };

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
  if (update.message?.from && (update.message.text || update.message.photo?.length || update.message.document)) {
    return handleMessage(update.message);
  }

  return NextResponse.json({ ok: true });
}

// «Нет доступа» — тот же префикс, по которому мост (scripts/telegram-poller.mjs) пишет auth=denied.
const UNLINKED_TEXT = "Нет доступа. Этот бот — панель владельца магазина Vialabote.";

function incomingFile(message: TelegramMessage): IncomingFile | undefined {
  if (message.photo?.length) return { fileId: message.photo[message.photo.length - 1].file_id, kind: "photo" };
  if (message.document) return { fileId: message.document.file_id, kind: "document", mimeType: message.document.mime_type };
  return undefined;
}

function inputReplyJson(chatId: number, reply: InputReply) {
  if (reply.type === "photo") {
    return NextResponse.json({
      method: "sendPhoto",
      chat_id: chatId,
      photo: reply.fileId,
      caption: reply.caption,
      reply_markup: { inline_keyboard: reply.keyboard },
    });
  }
  return NextResponse.json({
    method: "sendMessage",
    chat_id: chatId,
    text: reply.text,
    ...(reply.keyboard ? { reply_markup: { inline_keyboard: reply.keyboard } } : {}),
  });
}

function isPrivate(chat: TelegramChat | undefined): boolean {
  return !chat?.type || chat.type === "private";
}

async function handleMessage(message: TelegramMessage) {
  const telegramUserId = String(message.from!.id);
  const chatId = message.chat.id;

  if (!isPrivate(message.chat)) {
    return NextResponse.json({ ok: true });
  }

  // Единый вход: не владелец -> «Нет доступа» на любое сообщение (текст, фото, команды).
  if (!(await isPanelReader(telegramUserId))) {
    return NextResponse.json({ method: "sendMessage", chat_id: chatId, text: UNLINKED_TEXT });
  }
  const writer = await canWrite(telegramUserId);

  const menu = message.text ? isMenuCommand(message.text) : null;
  if (menu) {
    if (writer) await cancelInputs(telegramUserId); // меню всегда сбрасывает ожидание ввода
    const screen = menuScreen(writer);
    return NextResponse.json({
      method: "sendMessage",
      chat_id: chatId,
      text: menu === "help" ? helpText(writer) : screen.text,
      reply_markup: menu === "help" ? MENU_MARKUP : { inline_keyboard: screen.keyboard },
    });
  }

  // Бот ждёт ввод (число остатка, новое название, фото…) — только для тех, кому можно писать.
  const file = incomingFile(message);
  if (writer) {
    const reply = await handleInputMessage(telegramUserId, { text: message.text, file });
    if (reply) return inputReplyJson(chatId, reply);
  }
  if (!message.text) {
    return NextResponse.json({
      method: "sendMessage",
      chat_id: chatId,
      text: writer ? "Чтобы заменить фото: Товары → товар → «Фото», затем пришлите снимок." : "Фото через бота сейчас не принимаются.",
      reply_markup: MENU_MARKUP,
    });
  }

  const result = await prepareCommand(telegramUserId, message.text.trim());

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

  // Любая кнопка — только владельцу (TELEGRAM_ADMIN_IDS; без списка — ADMIN в БД, как в V2).
  if (!(await isPanelReader(telegramUserId))) {
    return NextResponse.json({ method: "answerCallbackQuery", callback_query_id: query.id, text: "Нет доступа", show_alert: true });
  }

  // Экраны "v2:<screen>:<page>" и действия "a:<op>:…". Ответ — editMessageText; спиннер кнопки
  // гасит мост answerCallbackQuery'ем (scripts/telegram-poller.mjs), toast — сам маршрут.
  if (data.startsWith("v2:") || data.startsWith("a:")) {
    const stale = () =>
      NextResponse.json({ method: "answerCallbackQuery", callback_query_id: query.id, text: "Кнопка устарела — откройте /menu" });
    if (chatId === undefined || messageId === undefined) return stale();
    const writer = await canWrite(telegramUserId);
    let screen;
    if (data.startsWith("v2:")) {
      const target = parseCallback(data);
      if (!target) return stale();
      screen = await renderScreen(target.screen, target.page, new Date(), writer);
    } else {
      const action = parseAction(data);
      if (!action) return stale();
      const result = await handleAction(action, { telegramUserId, canWrite: writer });
      if ("toast" in result) {
        return NextResponse.json({ method: "answerCallbackQuery", callback_query_id: query.id, text: result.toast, show_alert: true });
      }
      screen = result;
    }
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

  // Предпросмотр фото — это фото-сообщение, его текст editMessageText не заменит: отвечаем новым сообщением.
  const isPhotoPreview = Boolean(query.message && "photo" in query.message);
  const reply = (text: string) =>
    isPhotoPreview
      ? NextResponse.json({ method: "sendMessage", chat_id: chatId, text, reply_markup: MENU_MARKUP })
      : NextResponse.json({ method: "editMessageText", chat_id: chatId, message_id: messageId, text, reply_markup: MENU_MARKUP });

  if (action === "cancel") {
    try {
      await declineConfirmation(telegramUserId, confirmationId);
      return reply("Отменено. Ничего не изменено.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось отменить";
      return NextResponse.json({ method: "sendMessage", chat_id: chatId, text: message });
    }
  }

  const outcome = await executeConfirmation(telegramUserId, confirmationId);
  return reply(outcome.ok ? `✅ ${outcome.message}` : `⛔ ${outcome.message}`);
}
