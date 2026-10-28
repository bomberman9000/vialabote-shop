// Превью ссылок в мессенджерах (Open Graph): картинки 1200×630 JPEG из scripts/media/share-images.mjs.
import fs from "node:fs";
import path from "node:path";

/** Публичный адрес магазина: из него строятся абсолютные og:image и canonical. */
export const SITE_URL = "https://shop.vialabote.ru";

export const SHARE_IMAGE = {
  url: "/og/vialabote-share.jpg",
  width: 1200,
  height: 630,
  alt: "VIA LABOTE — уход и косметика с доставкой по России",
};

/**
 * Превью ссылки на товар: JPEG по имени его фото (`/images/products/packshot/<имя>.webp` → `/og/products/<имя>.jpg`).
 * Своего превью нет (новый товар, другое фото) — баннер магазина. WebP напрямую не отдаём: WhatsApp его не показывает.
 */
export function productShareImage(imageUrl: string, title: string, publicDir = path.join(process.cwd(), "public")) {
  const name = /^\/images\/products\/packshot\/([a-z0-9-]+)\.webp$/.exec(imageUrl)?.[1];
  const url = name ? `/og/products/${name}.jpg` : null;
  if (url && fs.existsSync(path.join(publicDir, url))) return { url, width: 1200, height: 630, alt: title };
  return SHARE_IMAGE;
}
