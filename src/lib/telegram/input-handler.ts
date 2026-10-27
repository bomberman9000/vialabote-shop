// Сообщения владельца, когда бот «ждёт ввод»: число остатка, новое название/цена/описание/INCI, фото.
// Ввод НЕ записывается: после проверки создаётся PendingConfirmation и показывается «было → станет».
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/money";
import { validateMedia } from "@/lib/media/validator";
import { createPendingConfirmation } from "./confirmation-service";
import { closeInput, peekInput } from "./input-session";
import { cardPreview, FIELD_LABEL, isTextField, parseTextField } from "./card-edit";
import { parseStockInput, stockPreview } from "./stock";
import { downloadTelegramFile, TelegramDownloadError } from "./file-download";
import { confirmKeyboard } from "./panel-actions";
import type { InlineKeyboard } from "./panel";

export interface IncomingFile {
  fileId: string;
  kind: "photo" | "document";
  mimeType?: string;
}
export type InputReply =
  | { type: "text"; text: string; keyboard?: InlineKeyboard }
  | { type: "photo"; fileId: string; caption: string; keyboard: InlineKeyboard };

const CANCEL: InlineKeyboard = [[{ text: "✖️ Отмена", callback_data: "a:ci" }]];

/** null — бот ничего не ждал, сообщение обрабатывается как обычно. */
export async function handleInputMessage(
  telegramUserId: string,
  msg: { text?: string; file?: IncomingFile },
  deps: { download?: typeof downloadTelegramFile } = {},
): Promise<InputReply | null> {
  const awaiting = await peekInput(telegramUserId);
  if (!awaiting) return null;
  const product = await prisma.product.findUnique({ where: { id: awaiting.productId } });
  if (!product) {
    await closeInput(awaiting.id);
    return { type: "text", text: "Товар не найден — откройте список заново." };
  }

  if (awaiting.kind === "INPUT_PHOTO") {
    if (!msg.file) return { type: "text", text: "Жду фото товара (лучше «как файл»). Или нажмите «Отмена».", keyboard: CANCEL };
    if (msg.file.kind === "document" && !/^image\/(jpeg|png|webp)$/.test(msg.file.mimeType ?? "")) {
      return { type: "text", text: "Нужен файл JPEG, PNG или WebP.", keyboard: CANCEL };
    }
    let bytes: Uint8Array;
    try {
      bytes = await (deps.download ?? downloadTelegramFile)(msg.file.fileId);
    } catch (err) {
      return { type: "text", text: err instanceof TelegramDownloadError ? err.message : "Не удалось получить файл.", keyboard: CANCEL };
    }
    const v = validateMedia(bytes, "PRODUCT_PRIMARY");
    if (!v.valid) {
      return { type: "text", text: `Фото не подходит: ${v.reasons.join("; ")}. Пришлите другое или «Отмена».`, keyboard: CANCEL };
    }
    if (!(await closeInput(awaiting.id))) return null;
    const c = await createPendingConfirmation({
      actorTelegramUserId: telegramUserId,
      commandType: "SET_PHOTO",
      entityType: "Product",
      entityId: product.id,
      expectedEntityVersion: product.version,
      payload: { fileId: msg.file.fileId },
    });
    return {
      type: "photo",
      fileId: msg.file.fileId,
      caption: `Новое главное фото «${product.title}» (${v.width}×${v.height}). Заменить текущее?`,
      keyboard: confirmKeyboard(c.id),
    };
  }

  // дальше нужен текст
  if (typeof msg.text !== "string") return { type: "text", text: "Жду текстовое сообщение. Или нажмите «Отмена».", keyboard: CANCEL };

  if (awaiting.kind === "INPUT_STOCK") {
    const parsed = parseStockInput(msg.text, product.stock);
    if (!parsed.ok) return { type: "text", text: parsed.error, keyboard: CANCEL };
    if (parsed.value === product.stock) {
      await closeInput(awaiting.id);
      return { type: "text", text: `Остаток «${product.title}» уже ${product.stock} шт. — менять нечего.` };
    }
    if (!(await closeInput(awaiting.id))) return null;
    const c = await createPendingConfirmation({
      actorTelegramUserId: telegramUserId,
      commandType: "SET_STOCK",
      entityType: "Product",
      entityId: product.id,
      expectedEntityVersion: product.version,
      payload: { stock: parsed.value },
    });
    return { type: "text", text: `${stockPreview(product.title, product.stock, parsed.value)}\n\nПодтвердить запись?`, keyboard: confirmKeyboard(c.id) };
  }

  // INPUT_FIELD
  const field = String(awaiting.payload.field ?? "");
  if (!isTextField(field)) {
    await closeInput(awaiting.id);
    return { type: "text", text: "Не понял, какое поле менять — откройте товар заново." };
  }
  const parsed = parseTextField(field, msg.text);
  if (!parsed.ok) return { type: "text", text: parsed.error, keyboard: CANCEL };
  if (!(await closeInput(awaiting.id))) return null;
  const c = await createPendingConfirmation({
    actorTelegramUserId: telegramUserId,
    commandType: field === "price" ? "SET_PRICE" : "EDIT_FIELD",
    entityType: "Product",
    entityId: product.id,
    expectedEntityVersion: product.version,
    payload: field === "price" ? { price: parsed.value } : { field, value: parsed.value },
  });
  const preview = cardPreview(field, product, parsed.value, formatPrice);
  return { type: "text", text: `${preview}\n\nПодтвердить запись? (${FIELD_LABEL[field]})`, keyboard: confirmKeyboard(c.id) };
}
