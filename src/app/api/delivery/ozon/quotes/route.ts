import { NextResponse } from "next/server";
import { z } from "zod";
import { getCheckoutOzon, quotePoints } from "@/lib/delivery/ozon-service";
import { disabled, limited, tooMany } from "@/lib/delivery/ozon-http";

export const dynamic = "force-dynamic";

const schema = z.object({
  items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive().max(100) })).min(1).max(50),
  mapPointIds: z.array(z.string().regex(/^\d{1,19}$/)).min(1).max(10),
});

/**
 * Цена и МАКСИМАЛЬНЫЙ срок корзины сразу для списка пунктов (до 10) — показываются у каждого пункта,
 * недоступные помечаются до выбора. Только для показа: при оформлении сервер считает заново.
 * Один запрос — до 10 расчётов в Ozon, поэтому лимит строже, чем у /quote: 6 в минуту с адреса
 * (120 со всех — не больше ~20 расчётов в секунду из общей квоты Ozon 50 rps); дальше пункты
 * показываются без цены, а расчёт делается при выборе.
 */
export async function POST(req: Request) {
  const ozon = getCheckoutOzon();
  if (!ozon) return disabled();
  if (limited(req, "quotes", 6)) return tooMany();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const all = await quotePoints(ozon, { lines: parsed.data.items, mapPointIds: parsed.data.mapPointIds });
  const quotes = Object.fromEntries(
    Object.entries(all).map(([id, q]) => [
      id,
      q === null
        ? null
        : q.available
          ? { available: true, priceKopecks: q.priceKopecks, maxDate: q.maxDate }
          : { available: false, reason: q.reason },
    ]),
  );
  return NextResponse.json({ quotes });
}
