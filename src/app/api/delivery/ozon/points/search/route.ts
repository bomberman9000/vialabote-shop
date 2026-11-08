import { NextResponse } from "next/server";
import { z } from "zod";
import { getCheckoutOzon, pointsOnStreet } from "@/lib/delivery/ozon-service";
import { streetQueryTokens } from "@/lib/delivery/address-match";
import { disabled, limited, ozonFailure, tooMany } from "@/lib/delivery/ozon-http";

export const dynamic = "force-dynamic";

const schema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  long: z.coerce.number().min(-180).max(180),
  q: z.string().trim().min(2).max(80),
});

/**
 * ПВЗ на улице: ?lat=&long= — центр города, ?q= — улица и, если нужно, дом («Свободы 2»).
 * Ответ — готовые карточки с расстоянием от центра, до 50 штук. Первый поиск в городе тяжелее (карточки из Ozon),
 * поэтому лимит частоты строже, чем у /points.
 */
export async function GET(req: Request) {
  const ozon = getCheckoutOzon();
  if (!ozon) return disabled();
  if (limited(req, "points-search", 20)) return tooMany();
  const p = schema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!p.success || streetQueryTokens(p.data.q).length === 0) {
    return NextResponse.json({ error: "Укажите lat, long и улицу (q)" }, { status: 400 });
  }
  try {
    return NextResponse.json({ points: await pointsOnStreet(ozon, { lat: p.data.lat, long: p.data.long }, p.data.q) });
  } catch (err) {
    return ozonFailure(err, "points/search");
  }
}
