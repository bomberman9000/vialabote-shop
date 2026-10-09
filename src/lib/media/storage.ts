// Abstraction поверх места хранения файлов. Owner decision: сейчас только
// LocalMediaStorage (без внешнего storage provider), но весь остальной код
// (admin commands, Telegram handlers) работает ТОЛЬКО через этот интерфейс —
// замена на S3-совместимое хранилище не потребует правок бизнес-логики.
export interface StoredMedia {
  storageKey: string; // серверное имя файла — никогда не имя от пользователя
  url: string; // публичный путь, формируется ТОЛЬКО после успешной валидации
}

export interface MediaStorage {
  /** Сохраняет уже провалидированные байты. Имя генерирует сама реализация. */
  save(bytes: Uint8Array, extension: string): Promise<StoredMedia>;
  delete(storageKey: string): Promise<void>;
}
