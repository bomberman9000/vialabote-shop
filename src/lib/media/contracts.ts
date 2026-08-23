// Единый реестр media contracts. И Web Admin, и Telegram проходят через
// MediaContractValidator (см. validator.ts) — никакой отдельной валидации
// для Telegram.
export type MediaPurpose =
  | "HERO_DESKTOP"
  | "HERO_MOBILE"
  | "PRODUCT_PRIMARY"
  | "PRODUCT_GALLERY"
  | "CATEGORY_TILE"
  | "PROMO_BANNER";

export interface MediaContract {
  purpose: MediaPurpose;
  allowedMimeTypes: string[];
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
  preferredWidth: number;
  preferredHeight: number;
  aspectRatio: number; // width / height
  aspectRatioTolerance: number; // допустимое отклонение (доля, напр. 0.02 = 2%)
  maxBytes: number;
  alphaAllowed: boolean;
  animationAllowed: boolean;
}

const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

export const MEDIA_CONTRACTS: Record<MediaPurpose, MediaContract> = {
  HERO_DESKTOP: {
    purpose: "HERO_DESKTOP",
    allowedMimeTypes: IMAGE_MIME_TYPES,
    minWidth: 1600,
    minHeight: 900,
    maxWidth: 3840,
    maxHeight: 2160,
    preferredWidth: 1920,
    preferredHeight: 1080,
    aspectRatio: 16 / 9,
    aspectRatioTolerance: 0.02,
    maxBytes: 4 * 1024 * 1024,
    alphaAllowed: false,
    animationAllowed: false,
  },
  HERO_MOBILE: {
    purpose: "HERO_MOBILE",
    allowedMimeTypes: IMAGE_MIME_TYPES,
    minWidth: 750,
    minHeight: 1000,
    maxWidth: 1500,
    maxHeight: 2000,
    preferredWidth: 1080,
    preferredHeight: 1440,
    aspectRatio: 3 / 4,
    aspectRatioTolerance: 0.03,
    maxBytes: 3 * 1024 * 1024,
    alphaAllowed: false,
    animationAllowed: false,
  },
  PRODUCT_PRIMARY: {
    purpose: "PRODUCT_PRIMARY",
    allowedMimeTypes: IMAGE_MIME_TYPES,
    minWidth: 1200,
    minHeight: 1200,
    maxWidth: 4000,
    maxHeight: 4000,
    preferredWidth: 1600,
    preferredHeight: 1600,
    aspectRatio: 1,
    aspectRatioTolerance: 0.02,
    maxBytes: 5 * 1024 * 1024,
    alphaAllowed: true, // допускаем прозрачный фон продуктового фото
    animationAllowed: false,
  },
  PRODUCT_GALLERY: {
    purpose: "PRODUCT_GALLERY",
    allowedMimeTypes: IMAGE_MIME_TYPES,
    minWidth: 1200,
    minHeight: 1200,
    maxWidth: 4000,
    maxHeight: 4000,
    preferredWidth: 1600,
    preferredHeight: 1600,
    aspectRatio: 1,
    aspectRatioTolerance: 0.02,
    maxBytes: 5 * 1024 * 1024,
    alphaAllowed: true,
    animationAllowed: false,
  },
  CATEGORY_TILE: {
    purpose: "CATEGORY_TILE",
    allowedMimeTypes: IMAGE_MIME_TYPES,
    minWidth: 800,
    minHeight: 800,
    maxWidth: 2400,
    maxHeight: 2400,
    preferredWidth: 1200,
    preferredHeight: 1200,
    aspectRatio: 1,
    aspectRatioTolerance: 0.03,
    maxBytes: 2 * 1024 * 1024,
    alphaAllowed: false,
    animationAllowed: false,
  },
  PROMO_BANNER: {
    purpose: "PROMO_BANNER",
    allowedMimeTypes: IMAGE_MIME_TYPES,
    minWidth: 1200,
    minHeight: 600,
    maxWidth: 3200,
    maxHeight: 1600,
    preferredWidth: 1600,
    preferredHeight: 800,
    aspectRatio: 2 / 1,
    aspectRatioTolerance: 0.02,
    maxBytes: 3 * 1024 * 1024,
    alphaAllowed: false,
    animationAllowed: false,
  },
};

export function getContract(purpose: MediaPurpose): MediaContract {
  return MEDIA_CONTRACTS[purpose];
}

// Общий потолок ДО того, как известен purpose (upload route ещё не
// распарсил FormData) — чуть выше самого большого maxBytes контракта (5MB)
// с запасом на multipart-overhead. Проверяется по Content-Length ДО
// req.formData()/arrayBuffer(), чтобы не буферизовать в память запрос,
// который в любом случае будет отклонён per-purpose валидацией — иначе
// сколь угодно большой upload полностью читается в память раньше любой
// проверки размера (memory-exhaustion DoS поверхность).
export const MAX_UPLOAD_REQUEST_BYTES = 8 * 1024 * 1024;

export function isMediaPurpose(value: string): value is MediaPurpose {
  return Object.prototype.hasOwnProperty.call(MEDIA_CONTRACTS, value);
}
