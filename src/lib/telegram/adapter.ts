// Абстракция транспорта Telegram — бизнес-логика (dispatch-command.ts,
// webhook route) НИКОГДА не обращается к Bot API напрямую и не хардкодит
// URL/токен. Реальный HttpTelegramAdapter подключается отдельной задачей
// (owner decision), когда появится настоящий токен и публичный webhook URL.
// До этого адаптер существует только как интерфейс + тестовый in-memory
// double — то же разделение, что MediaStorage/LocalMediaStorage.

export interface InlineButton {
  text: string;
  callbackData: string;
}

export interface OutgoingMessage {
  chatId: string;
  text: string;
  buttons?: InlineButton[][];
}

export interface TelegramAdapter {
  sendMessage(message: OutgoingMessage): Promise<void>;
}

export class InMemoryTelegramAdapter implements TelegramAdapter {
  public readonly sent: OutgoingMessage[] = [];

  async sendMessage(message: OutgoingMessage): Promise<void> {
    this.sent.push(message);
  }
}
