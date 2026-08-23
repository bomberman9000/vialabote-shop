import { describe, it, expect } from "vitest";
import { validateMedia } from "./validator";
import {
  makePngBytes,
  makeJpegBytes,
  makeWebpBytes,
  makeBrokenBytes,
  makeExecutableDisguisedAsImage,
  makeSvgBytes,
  makeGifBytes,
} from "./test-fixtures";

describe("validateMedia — HERO_DESKTOP contract (16:9, 1600x900 min)", () => {
  it("корректное hero-изображение проходит валидацию", () => {
    const bytes = makeJpegBytes(1920, 1080);
    const result = validateMedia(bytes, "HERO_DESKTOP");
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.mimeType).toBe("image/jpeg");
    }
  });

  it("неправильный ratio (2:1 вместо 16:9) отклоняется с конкретной причиной", () => {
    const bytes = makeJpegBytes(1600, 800); // 2:1
    const result = validateMedia(bytes, "HERO_DESKTOP");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("соответствует"))).toBe(true);
    }
  });

  it("слишком маленькое изображение отклоняется (1200x600 < 1600x900 min)", () => {
    const bytes = makeJpegBytes(1200, 600);
    const result = validateMedia(bytes, "HERO_DESKTOP");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("меньше минимума"))).toBe(true);
    }
  });

  it("слишком большое изображение отклоняется (превышает maxWidth/maxHeight)", () => {
    const bytes = makeJpegBytes(5000, 2812);
    const result = validateMedia(bytes, "HERO_DESKTOP");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("больше максимума"))).toBe(true);
    }
  });
});

describe("validateMedia — PRODUCT_PRIMARY contract (1:1, 1200 min)", () => {
  it("корректное квадратное фото товара проходит", () => {
    const bytes = makePngBytes(1600, 1600);
    const result = validateMedia(bytes, "PRODUCT_PRIMARY");
    expect(result.valid).toBe(true);
  });

  it("не квадратное фото отклоняется", () => {
    const bytes = makePngBytes(1600, 1000);
    const result = validateMedia(bytes, "PRODUCT_PRIMARY");
    expect(result.valid).toBe(false);
  });
});

describe("validateMedia — MIME определяется по байтам, не по заявленному расширению", () => {
  it("executable, выдающий себя за картинку (MZ header) — reject", () => {
    const bytes = makeExecutableDisguisedAsImage();
    const result = validateMedia(bytes, "PRODUCT_PRIMARY");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("Не удалось распознать"))).toBe(true);
    }
  });

  it("настоящий webp с правильными размерами определяется корректно вне зависимости от расширения файла", () => {
    const bytes = makeWebpBytes(1600, 1600);
    const result = validateMedia(bytes, "PRODUCT_PRIMARY");
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.mimeType).toBe("image/webp");
  });
});

describe("validateMedia — invalid/unsupported формат", () => {
  it("SVG отклоняется явно (нет sanitization-стратегии)", () => {
    const result = validateMedia(makeSvgBytes(), "PRODUCT_PRIMARY");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reasons.some((r) => r.includes("SVG"))).toBe(true);
  });

  it("GIF отклоняется (не в allowlist контрактов)", () => {
    const result = validateMedia(makeGifBytes(), "PRODUCT_PRIMARY");
    expect(result.valid).toBe(false);
  });

  it("анимированный WebP отклоняется, если animationAllowed=false", () => {
    const bytes = makeWebpBytes(1600, 1600, true);
    const result = validateMedia(bytes, "PRODUCT_PRIMARY");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.some((r) => r.includes("Анимированные"))).toBe(true);
    }
  });
});

describe("validateMedia — broken/malformed файл", () => {
  it("обрубленный/битый файл не роняет валидатор исключением", () => {
    expect(() => validateMedia(makeBrokenBytes(), "PRODUCT_PRIMARY")).not.toThrow();
    const result = validateMedia(makeBrokenBytes(), "PRODUCT_PRIMARY");
    expect(result.valid).toBe(false);
  });

  it("пустой файл отклоняется", () => {
    const result = validateMedia(new Uint8Array(0), "PRODUCT_PRIMARY");
    expect(result.valid).toBe(false);
  });
});

describe("validateMedia — file size limit", () => {
  it("файл больше maxBytes отклоняется", () => {
    // Реальный контент (валидный JPEG) + добить padding сверх лимита contract'а.
    const real = makeJpegBytes(1600, 1600);
    const padding = Buffer.alloc(6 * 1024 * 1024); // 6MB > 5MB лимита PRODUCT_PRIMARY
    const bytes = Buffer.concat([real, padding]);
    const result = validateMedia(bytes, "PRODUCT_PRIMARY");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reasons.some((r) => r.includes("МБ"))).toBe(true);
  });
});

describe("validateMedia — assist mode suggestion", () => {
  it("достаточно большое, но неверный ratio изображение получает assist-предложение", () => {
    const bytes = makeJpegBytes(2000, 2000); // квадрат, но HERO нужен 16:9
    const result = validateMedia(bytes, "HERO_DESKTOP");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.assistSuggestion).toBeDefined();
      expect(result.assistSuggestion).not.toContain("автомат"); // никакой авто-публикации
    }
  });

  it("слишком маленькое изображение НЕ получает assist (нельзя апскейлить безопасно)", () => {
    const bytes = makeJpegBytes(400, 400);
    const result = validateMedia(bytes, "HERO_DESKTOP");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.assistSuggestion).toBeUndefined();
  });
});
