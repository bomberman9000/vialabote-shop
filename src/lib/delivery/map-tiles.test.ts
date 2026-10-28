import { describe, it, expect } from "vitest";
import { mapTileConfig } from "./map-tiles";

const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

describe("подложка карты: только свой сервер плиток", () => {
  it("без MAP_TILE_URL карты нет", () => {
    expect(mapTileConfig(env({}))).toBeNull();
  });

  it("свой путь или https; подпись и масштаб по умолчанию", () => {
    expect(mapTileConfig(env({ MAP_TILE_URL: "/maps/current/styles/gruzpotok/{z}/{x}/{y}.png" }))).toEqual({
      url: "/maps/current/styles/gruzpotok/{z}/{x}/{y}.png",
      attribution: "© OpenMapTiles © OpenStreetMap contributors",
      maxZoom: 18,
    });
    expect(mapTileConfig(env({ MAP_TILE_URL: "https://maps.example.ru/{z}/{x}/{y}.png", MAP_TILE_MAX_ZOOM: "16" }))?.maxZoom).toBe(16);
  });

  it("отвергает адрес без {z}/{x}/{y}, протокол-относительный, http не на localhost и логин в URL", () => {
    for (const url of [
      "/maps/tile.png",
      "//evil.example/{z}/{x}/{y}.png",
      "http://maps.example.ru/{z}/{x}/{y}.png",
      "https://user:pw@maps.example.ru/{z}/{x}/{y}.png",
      "javascript:alert(1)//{z}/{x}/{y}",
    ]) {
      expect(mapTileConfig(env({ MAP_TILE_URL: url }))).toBeNull();
    }
    expect(mapTileConfig(env({ MAP_TILE_URL: "http://127.0.0.1:8080/styles/gruzpotok/{z}/{x}/{y}.png" }))).not.toBeNull();
  });

  it("подпись с HTML или слишком длинная — заменяется стандартной; кривой масштаб — 18", () => {
    const base = { MAP_TILE_URL: "/maps/{z}/{x}/{y}.png" };
    expect(mapTileConfig(env({ ...base, MAP_TILE_ATTRIBUTION: "<img src=x onerror=alert(1)>" }))?.attribution).toBe(
      "© OpenMapTiles © OpenStreetMap contributors",
    );
    expect(mapTileConfig(env({ ...base, MAP_TILE_ATTRIBUTION: "x".repeat(121) }))?.attribution).toBe("© OpenMapTiles © OpenStreetMap contributors");
    expect(mapTileConfig(env({ ...base, MAP_TILE_ATTRIBUTION: "© VIA LABOTE © OpenStreetMap" }))?.attribution).toBe("© VIA LABOTE © OpenStreetMap");
    expect(mapTileConfig(env({ ...base, MAP_TILE_MAX_ZOOM: "99" }))?.maxZoom).toBe(18);
  });
});
