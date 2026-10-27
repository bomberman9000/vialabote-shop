// Скачивание файла, присланного боту (Bot API getFile + file/bot<token>/<path>).
// Токен берётся из окружения и НИКОГДА не попадает в сообщения об ошибках/логи: URL скачивания
// содержит токен, поэтому любая ошибка заменяется обезличенным текстом.
import { getTelegramBotToken } from "./config";

export const MAX_DOWNLOAD_BYTES = 6 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

export class TelegramDownloadError extends Error {}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export async function downloadTelegramFile(
  fileId: string,
  { fetchImpl = fetch as FetchLike, token = getTelegramBotToken(), apiBase = process.env.TELEGRAM_API_BASE || "https://api.telegram.org" } = {},
): Promise<Uint8Array> {
  const base = apiBase.replace(/\/$/, "");
  try {
    const meta = await fetchImpl(`${base}/bot${token}/getFile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await meta.json()) as { ok?: boolean; result?: { file_path?: string; file_size?: number } };
    const filePath = body.result?.file_path;
    if (!meta.ok || body.ok !== true || !filePath) throw new TelegramDownloadError("getFile отклонён");
    if ((body.result?.file_size ?? 0) > MAX_DOWNLOAD_BYTES) throw new TelegramDownloadError("Файл слишком большой");
    const file = await fetchImpl(`${base}/file/bot${token}/${filePath}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!file.ok) throw new TelegramDownloadError("Скачивание отклонено");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_DOWNLOAD_BYTES) throw new TelegramDownloadError("Файл слишком большой");
    return bytes;
  } catch (err) {
    if (err instanceof TelegramDownloadError && err.message === "Файл слишком большой") throw err;
    throw new TelegramDownloadError("Не удалось скачать файл из Telegram. Попробуйте ещё раз.");
  }
}
