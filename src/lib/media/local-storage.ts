import { randomUUID } from "crypto";
import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";
import type { MediaStorage, StoredMedia } from "./storage";

// Контролируемая директория внутри public/ — public/ уже статически
// раздаётся Next.js, ничего в ней не исполняется как код.
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "media");
const PUBLIC_PREFIX = "/uploads/media";

const ALLOWED_EXTENSIONS = new Set(["jpg", "png", "webp"]);

export class LocalMediaStorage implements MediaStorage {
  async save(bytes: Uint8Array, extension: string): Promise<StoredMedia> {
    const ext = extension.toLowerCase().replace(/^\./, "");
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new Error(`Недопустимое расширение для сохранения: ${ext}`);
    }

    await mkdir(UPLOAD_DIR, { recursive: true });

    // Имя генерируется ТОЛЬКО сервером (randomUUID) — user filename никогда
    // не участвует в построении пути. path traversal невозможен: нет
    // пользовательского ввода в пути вообще.
    const storageKey = `${randomUUID()}.${ext}`;
    const filePath = path.join(UPLOAD_DIR, storageKey);

    // Defense-in-depth: убеждаемся, что итоговый путь всё ещё внутри UPLOAD_DIR.
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
      throw new Error("Отклонено: путь сохранения вне разрешённой директории");
    }

    await writeFile(filePath, bytes, { mode: 0o644 });

    return { storageKey, url: `${PUBLIC_PREFIX}/${storageKey}` };
  }

  async delete(storageKey: string): Promise<void> {
    if (storageKey.includes("..") || storageKey.includes("/") || storageKey.includes("\\")) {
      throw new Error("Отклонено: подозрительный storageKey");
    }
    const filePath = path.join(UPLOAD_DIR, storageKey);
    await unlink(filePath).catch(() => {
      // Файла уже нет — идемпотентно, не ошибка.
    });
  }
}

export function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      throw new Error(`Нет расширения для MIME: ${mimeType}`);
  }
}
