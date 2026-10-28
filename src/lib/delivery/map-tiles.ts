// Подложка карты пунктов Ozon — только свой сервер плиток (как карта ГрузПотока: tileserver-gl + MBTiles на нашем VPS).
// Сторонних картографических сервисов нет: без MAP_TILE_URL карты в checkout нет вовсе, поиск по улице работает и так.

export interface MapTiles {
  url: string;
  attribution: string;
  maxZoom: number;
}

/** Данные OpenStreetMap (ODbL) требуют упоминания источника — даже на своём сервере плиток. */
const DEFAULT_ATTRIBUTION = "© OpenMapTiles © OpenStreetMap contributors";

/** Адрес плиток: свой путь (`/maps/…/{z}/{x}/{y}.png`) или https без логина в URL; http — только localhost. */
function safeTileUrl(raw: string | undefined): string | null {
  const url = raw?.trim() ?? "";
  if (!url || !["{z}", "{x}", "{y}"].every((t) => url.includes(t))) return null;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const u = new URL(url.replace(/\{[xyz]\}/g, "0"));
    if (u.username || u.password) return null;
    if (u.protocol === "https:") return url;
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ? url : null;
  } catch {
    return null;
  }
}

export function mapTileConfig(env: NodeJS.ProcessEnv = process.env): MapTiles | null {
  const url = safeTileUrl(env.MAP_TILE_URL);
  if (!url) return null;
  const a = env.MAP_TILE_ATTRIBUTION?.trim();
  const zoom = Number(env.MAP_TILE_MAX_ZOOM);
  return {
    url,
    // Подпись уходит в HTML Leaflet — без разметки.
    attribution: a && a.length <= 120 && !/[<>&"]/.test(a) ? a : DEFAULT_ATTRIBUTION,
    maxZoom: Number.isInteger(zoom) && zoom >= 1 && zoom <= 22 ? zoom : 18,
  };
}
