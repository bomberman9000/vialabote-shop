import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getWebAdminActor } from "@/lib/admin/api-response";
import { getProdOzon } from "@/lib/delivery/ozon-service";
import { cancelOzonOrder, retryOzonOrder, syncOzonOrder } from "@/lib/delivery/ozon-orders";

const schema = z.discriminatedUnion("action", [
  // Повтор после FAILED/UNKNOWN. Для UNKNOWN админ подтверждает, что проверил кабинет Ozon и заказа там нет.
  z.object({ action: z.literal("retry"), confirmNotInOzon: z.boolean().default(false) }),
  z.object({ action: z.literal("sync") }),
  z.object({ action: z.literal("cancel"), reasonId: z.number().int().positive().optional(), message: z.string().max(300).optional() }),
]);

/** Ручной разбор заказа Ozon в Web Admin: повторить создание, обновить статус, отменить. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const actor = await getWebAdminActor();
  if (!actor) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const oo = await prisma.ozonOrder.findUnique({ where: { orderId: params.id } });
  if (!oo) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const a = parsed.data;

  if (a.action === "retry") return NextResponse.json(await retryOzonOrder(params.id, { confirmNotInOzon: a.confirmNotInOzon }));
  if (a.action === "cancel") return NextResponse.json(await cancelOzonOrder(params.id, { reasonId: a.reasonId, message: a.message }));

  const ozon = getProdOzon();
  if (!ozon) return NextResponse.json({ error: "Ozon Доставка выключена" }, { status: 503 });
  try {
    await syncOzonOrder(oo.id, ozon);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "sync failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, ozon: await prisma.ozonOrder.findUnique({ where: { id: oo.id }, select: { state: true, status: true, postingNumbers: true, refundState: true } }) });
}
