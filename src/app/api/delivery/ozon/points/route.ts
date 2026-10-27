import { NextResponse } from "next/server";
import { z } from "zod";
import { getOzon, nearestPoints, pointsInViewport } from "@/lib/delivery/ozon-service";
import { disabled, limited, ozonFailure, tooMany } from "@/lib/delivery/ozon-http";

export const dynamic = "force-dynamic";

const lat = z.coerce.number().min(-90).max(90);
const long = z.coerce.number().min(-180).max(180);
const near = z.object({ lat, long, limit: z.coerce.number().int().min(1).max(50).default(20) });
const box = z.object({ minLat: lat, minLong: long, maxLat: lat, maxLong: long, limit: z.coerce.number().int().min(1).max(500).default(200) });

/**
 * Список ПВЗ Ozon (полный список у Ozon — только id и координаты; кешируется на 6 ч).
 * ?lat=&long=&limit= — ближайшие; ?minLat=&minLong=&maxLat=&maxLong= — в области карты.
 * Адреса и часы работы — /api/delivery/ozon/points/info.
 */
export async function GET(req: Request) {
  const ozon = getOzon();
  if (!ozon) return disabled();
  if (limited(req, "points", 60)) return tooMany();
  const q = Object.fromEntries(new URL(req.url).searchParams);
  try {
    if (q.minLat !== undefined) {
      const p = box.safeParse(q);
      if (!p.success) return NextResponse.json({ error: p.error.flatten() }, { status: 400 });
      const v = { left_bottom: { lat: p.data.minLat, long: p.data.minLong }, right_top: { lat: p.data.maxLat, long: p.data.maxLong } };
      return NextResponse.json({ points: await pointsInViewport(ozon, v, p.data.limit) });
    }
    const p = near.safeParse(q);
    if (!p.success) return NextResponse.json({ error: "Укажите lat и long или область карты" }, { status: 400 });
    return NextResponse.json({ points: await nearestPoints(ozon, { lat: p.data.lat, long: p.data.long }, p.data.limit) });
  } catch (err) {
    return ozonFailure(err, "points");
  }
}
