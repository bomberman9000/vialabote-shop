import { NextResponse } from "next/server";
import { getWebAdminActor, adminErrorResponse } from "@/lib/admin/api-response";
import { setDiscount, removeDiscount } from "@/lib/admin/commands/product";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const actor = await getWebAdminActor();
  if (!actor) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = (await req.json()) as {
    expectedVersion?: number;
    type?: string;
    value?: number;
    startsAt?: string | null;
    endsAt?: string | null;
  };

  try {
    const discount = await setDiscount(actor, {
      productId: params.id,
      expectedVersion: body.expectedVersion,
      type: body.type,
      value: body.value,
      startsAt: body.startsAt ? new Date(body.startsAt) : null,
      endsAt: body.endsAt ? new Date(body.endsAt) : null,
    });
    return NextResponse.json(discount);
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const actor = await getWebAdminActor();
  if (!actor) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { expectedVersion?: number };

  try {
    const result = await removeDiscount(actor, { productId: params.id, expectedVersion: body.expectedVersion });
    return NextResponse.json(result);
  } catch (err) {
    return adminErrorResponse(err);
  }
}
