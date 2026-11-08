import { NextResponse } from "next/server";
import { getCheckoutOzon } from "@/lib/delivery/ozon-service";
import { mapTileConfig } from "@/lib/delivery/map-tiles";

export const dynamic = "force-dynamic";

/**
 * Включена ли доставка Ozon (для checkout). Без учётных данных — false, сайт работает как раньше.
 * map — свой сервер плиток для карты пунктов (MAP_TILE_URL); null — кнопки «Выбрать на карте» нет.
 */
export async function GET() {
  const enabled = getCheckoutOzon() !== null;
  return NextResponse.json({ enabled, map: enabled ? mapTileConfig() : null });
}
