import { NextResponse } from "next/server";
import { z } from "zod";
import { getOzon, quoteCart } from "@/lib/delivery/ozon-service";
import { destinationSchema, disabled, limited, ozonFailure, tooMany } from "@/lib/delivery/ozon-http";

export const dynamic = "force-dynamic";

const schema = z.object({
  items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive().max(100) })).min(1).max(50),
  destination: destinationSchema,
});

/**
 * Цена и МАКСИМАЛЬНЫЙ срок доставки корзины (v2/delivery/checkout). Только для показа: при оформлении
 * заказа сервер считает заново, сумму с клиента не принимает. Телефон сюда не передаётся — он нужен
 * только при оформлении (проверка аккаунта Ozon для номера из заказа).
 */
export async function POST(req: Request) {
  const ozon = getOzon();
  if (!ozon) return disabled();
  if (limited(req, "quote", 30)) return tooMany();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    const q = await quoteCart(ozon, { lines: parsed.data.items, destination: parsed.data.destination });
    if (!q.available) return NextResponse.json({ available: false, reason: q.reason, productIds: q.productIds ?? [] });
    return NextResponse.json({
      available: true,
      deliveryType: q.deliveryType,
      priceKopecks: q.priceKopecks,
      maxDate: q.maxDate,
      shipments: q.splits.length,
    });
  } catch (err) {
    return ozonFailure(err, "quote");
  }
}
