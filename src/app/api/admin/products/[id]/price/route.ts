import { NextResponse } from "next/server";
import { getWebAdminActor, adminErrorResponse } from "@/lib/admin/api-response";
import { setPrice } from "@/lib/admin/commands/product";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const actor = await getWebAdminActor();
  if (!actor) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json();
  try {
    const product = await setPrice(actor, { productId: params.id, ...body });
    return NextResponse.json(product);
  } catch (err) {
    return adminErrorResponse(err);
  }
}
