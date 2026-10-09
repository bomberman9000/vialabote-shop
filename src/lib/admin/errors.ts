// Типизированные ошибки command-слоя. UI (Web/Telegram) показывает
// человекочитаемый message, никогда сырой stack trace/Prisma-ошибку.
export type AdminCommandErrorCode =
  | "FORBIDDEN"
  | "VALIDATION"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "INVALID_TRANSITION"
  | "MEDIA_REJECTED"
  | "AMBIGUOUS";

export class AdminCommandError extends Error {
  code: AdminCommandErrorCode;
  details?: unknown;

  constructor(code: AdminCommandErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
