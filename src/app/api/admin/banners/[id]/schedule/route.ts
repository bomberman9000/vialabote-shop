import { NextResponse } from "next/server";
import { getWebAdminActor, adminErrorResponse } from "@/lib/admin/api-response";
import { scheduleBanner } from "@/lib/admin/commands/banner";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const actor = await getWebAdminActor();
  if (!actor) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = (await req.json()) as { expectedVersion?: number; startsAt?: string | null; endsAt?: string | null };
  try {
    const banner = await scheduleBanner(actor, {
      bannerId: params.id,
      expectedVersion: body.expectedVersion,
      startsAt: body.startsAt ? new Date(body.startsAt) : null,
      endsAt: body.endsAt ? new Date(body.endsAt) : null,
    });
    return NextResponse.json(banner);
  } catch (err) {
    return adminErrorResponse(err);
  }
}
