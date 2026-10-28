// Общие ответы маршрутов /api/delivery/ozon/*: покупателю — без подробностей Ozon, в журнал — метод, путь, код.
import { NextResponse } from "next/server";
import { z } from "zod";
import { OzonError } from "./ozon";
import { allowRequest } from "./ozon-service";

/** Куда везти: ПВЗ по id точки на карте Ozon или курьером по координатам (так требует v2/delivery/checkout). */
export const destinationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PVZ"), mapPointId: z.string().regex(/^\d{1,19}$/) }),
  z.object({ type: z.literal("COURIER"), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }),
]);

const name = z.string().trim().min(1).max(60);

/** Доставка Ozon в теле POST /api/orders. Цены здесь нет: её считает сервер. */
export const ozonDeliverySchema = z.object({
  provider: z.literal("OZON"),
  destination: destinationSchema,
  recipient: z.object({ lastName: name, firstName: name, middleName: name.optional() }),
  courier: z
    .object({
      city: z.string().trim().min(2).max(100),
      street: z.string().trim().max(150).optional(),
      house: z.string().trim().min(1).max(30),
      apartment: z.string().trim().max(30).optional(),
      entrance: z.string().trim().max(30).optional(),
      floor: z.string().trim().max(30).optional(),
      intercom: z.string().trim().max(30).optional(),
      region: z.string().trim().max(100).optional(),
      zip: z.string().trim().max(12).optional(),
      comment: z.string().trim().max(300).optional(),
    })
    .optional(),
});

export const disabled = () => NextResponse.json({ error: "Доставка Ozon сейчас недоступна", disabled: true }, { status: 503 });

export const tooMany = () => NextResponse.json({ error: "Слишком много запросов, попробуйте через минуту" }, { status: 429 });

export function ozonFailure(err: unknown, where: string) {
  if (!(err instanceof OzonError)) throw err;
  console.error(`ozon ${where}:`, err.message);
  return NextResponse.json({ error: "Ozon не ответил, попробуйте ещё раз" }, { status: 502 });
}

export function limited(req: Request, bucket: string, limit?: number) {
  return !allowRequest(req, bucket, limit);
}
