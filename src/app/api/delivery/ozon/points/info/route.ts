import { NextResponse } from "next/server";
import { getCheckoutOzon, pointCards } from "@/lib/delivery/ozon-service";
import { disabled, limited, ozonFailure, tooMany } from "@/lib/delivery/ozon-http";

export const dynamic = "force-dynamic";

/** Карточки ПВЗ: ?ids=1,2,3 (до 100). Адрес, город, срок хранения, тип; каждая кешируется на час. */
export async function GET(req: Request) {
  const ozon = getCheckoutOzon();
  if (!ozon) return disabled();
  if (limited(req, "points-info", 60)) return tooMany();
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0 || ids.length > 100 || ids.some((id) => !/^\d{1,19}$/.test(id))) {
    return NextResponse.json({ error: "ids: от 1 до 100 числовых идентификаторов через запятую" }, { status: 400 });
  }
  try {
    return NextResponse.json({ points: await pointCards(ozon, ids) });
  } catch (err) {
    return ozonFailure(err, "points/info");
  }
}
