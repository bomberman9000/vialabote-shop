import imageSize from "image-size";
import { getContract, type MediaPurpose, type MediaContract } from "./contracts";
import { sniffMimeType, isLikelyAnimatedWebp } from "./sniff-mime";

export interface MediaValidationOk {
  valid: true;
  purpose: MediaPurpose;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface MediaValidationReject {
  valid: false;
  purpose: MediaPurpose;
  reasons: string[];
  // Assist mode: если можно безопасно предложить crop под нужный ratio —
  // сюда кладётся предложение. Сама обрезка НИКОГДА не выполняется
  // автоматически, только по отдельному подтверждению (Strict vs Assist,
  // см. PHASE 13 брифа) — этот слой лишь формирует TEXT-предложение,
  // выполнение crop реализуется отдельным шагом, не здесь.
  assistSuggestion?: string;
}

export type MediaValidationResult = MediaValidationOk | MediaValidationReject;

function ratioLabel(w: number, h: number): string {
  const divisor = gcd(w, h);
  return `${w / divisor}:${h / divisor}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Единая точка валидации медиа для Web Admin И Telegram (PHASE 4 брифа:
 * "Никакой отдельной Telegram-валидации"). Не доверяет ни расширению файла,
 * ни Content-Type от клиента — MIME определяется по содержимому байт.
 */
export function validateMedia(bytes: Uint8Array, purpose: MediaPurpose): MediaValidationResult {
  const contract = getContract(purpose);
  const reasons: string[] = [];

  const sizeBytes = bytes.byteLength;
  if (sizeBytes > contract.maxBytes) {
    // Early return — не тратим MIME-sniff/imageSize на заведомо отклонённый
    // файл (defense-in-depth против дорогой обработки крупных payload'ов).
    reasons.push(
      `Размер файла ${(sizeBytes / 1024 / 1024).toFixed(2)} МБ превышает максимум ${(contract.maxBytes / 1024 / 1024).toFixed(1)} МБ`,
    );
    return { valid: false, purpose, reasons };
  }
  if (sizeBytes === 0) {
    reasons.push("Файл пустой или повреждён");
    return { valid: false, purpose, reasons };
  }

  const mimeType = sniffMimeType(bytes);
  if (!mimeType) {
    reasons.push("Не удалось распознать формат файла (неподдерживаемый или повреждённый)");
    return { valid: false, purpose, reasons };
  }
  if (mimeType === "image/svg+xml") {
    reasons.push("SVG не поддерживается (нет отдельной sanitization-стратегии)");
    return { valid: false, purpose, reasons };
  }
  if (!contract.allowedMimeTypes.includes(mimeType)) {
    reasons.push(`Формат ${mimeType} не разрешён. Разрешены: ${contract.allowedMimeTypes.join(", ")}`);
  }

  if (!contract.animationAllowed && mimeType === "image/webp" && isLikelyAnimatedWebp(bytes)) {
    reasons.push("Анимированные изображения не поддерживаются для этого слота");
  }

  let width = 0;
  let height = 0;
  try {
    const dimensions = imageSize(bytes);
    width = dimensions.width ?? 0;
    height = dimensions.height ?? 0;
    if (!width || !height) throw new Error("no dimensions");
  } catch {
    reasons.push("Не удалось прочитать размеры изображения (файл повреждён)");
    return { valid: false, purpose, reasons };
  }

  if (width < contract.minWidth || height < contract.minHeight) {
    reasons.push(
      `Размер ${width}×${height} меньше минимума ${contract.minWidth}×${contract.minHeight}`,
    );
  }
  if (width > contract.maxWidth || height > contract.maxHeight) {
    reasons.push(
      `Размер ${width}×${height} больше максимума ${contract.maxWidth}×${contract.maxHeight}`,
    );
  }

  const actualRatio = width / height;
  const ratioDiff = Math.abs(actualRatio - contract.aspectRatio) / contract.aspectRatio;
  if (ratioDiff > contract.aspectRatioTolerance) {
    const requiredLabel = ratioLabel(
      Math.round(contract.aspectRatio * 100),
      100,
    );
    reasons.push(
      `Соотношение сторон ${ratioLabel(width, height)} (получено: ${width}×${height}) не соответствует требуемому ~${requiredLabel}`,
    );
  }

  if (reasons.length > 0) {
    return {
      valid: false,
      purpose,
      reasons,
      assistSuggestion: buildAssistSuggestion(width, height, contract),
    };
  }

  return { valid: true, purpose, mimeType, width, height, sizeBytes };
}

function buildAssistSuggestion(width: number, height: number, contract: MediaContract): string | undefined {
  // Assist-режим предлагается только если изображение УЖЕ достаточно большое,
  // чтобы безопасно обрезать до нужного ratio без апскейла/растяжения.
  if (width < contract.minWidth || height < contract.minHeight) return undefined;
  return `Можно подготовить crop под ${contract.preferredWidth}×${contract.preferredHeight} (${ratioLabel(
    Math.round(contract.aspectRatio * 100),
    100,
  )}). Предпросмотр перед публикацией обязателен.`;
}
