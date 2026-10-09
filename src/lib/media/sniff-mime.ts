// Определение MIME по magic bytes содержимого файла. Расширению файла и
// заголовку Content-Type от клиента НЕ доверяем никогда — это единственный
// источник истины о реальном формате (защита от MIME spoofing / fake
// extension / executable-выдающий-себя-за-картинку).
export function sniffMimeType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  // WEBP: "RIFF"....."WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  // GIF: "GIF87a" / "GIF89a" — распознаём, чтобы явно отклонить по policy
  // (не в allowlist контрактов), а не потому что не смогли определить тип.
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "image/gif";
  }

  // SVG — текстовый формат, магических байт нет; проверяем начало содержимого.
  // Явно НЕ поддерживается (запрещён без отдельной sanitization-стратегии).
  const head = Buffer.from(bytes.slice(0, 256)).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<?xml") || head.startsWith("<svg")) {
    return "image/svg+xml";
  }

  return null; // неизвестный/неподдерживаемый формат — reject
}

/** Грубая эвристика animated WebP: наличие ANIM/ANMF-чанков в контейнере. */
export function isLikelyAnimatedWebp(bytes: Uint8Array): boolean {
  const text = Buffer.from(bytes).toString("latin1");
  return text.includes("ANIM") && text.includes("ANMF");
}
