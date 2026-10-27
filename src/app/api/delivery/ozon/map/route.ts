import { NextResponse } from "next/server";
import { z } from "zod";
import { getOzon, mapClusters } from "@/lib/delivery/ozon-service";
import { disabled, limited, ozonFailure, tooMany } from "@/lib/delivery/ozon-http";

export const dynamic = "force-dynamic";

const point = z.object({ lat: z.number().min(-90).max(90), long: z.number().min(-180).max(180) });
const schema = z.object({ viewport: z.object({ left_bottom: point, right_top: point }), zoom: z.number().int().min(1).max(21) });

/** Кластеры ПВЗ для области карты (v1/delivery/map), кеш 10 минут по округлённой области. */
export async function POST(req: Request) {
  const ozon = getOzon();
  if (!ozon) return disabled();
  if (limited(req, "map", 60)) return tooMany();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    return NextResponse.json({ clusters: await mapClusters(ozon, parsed.data.viewport, parsed.data.zoom) });
  } catch (err) {
    return ozonFailure(err, "map");
  }
}
