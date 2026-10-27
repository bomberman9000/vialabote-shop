import { NextResponse } from "next/server";
import { getOzon } from "@/lib/delivery/ozon-service";

export const dynamic = "force-dynamic";

/** Включена ли доставка Ozon (для checkout). Без учётных данных — false, сайт работает как раньше. */
export async function GET() {
  return NextResponse.json({ enabled: getOzon() !== null });
}
