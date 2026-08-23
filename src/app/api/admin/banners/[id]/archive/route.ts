import { NextResponse } from "next/server";
import { getWebAdminActor, adminErrorResponse } from "@/lib/admin/api-response";
import { archiveBanner } from "@/lib/admin/commands/banner";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const actor = await getWebAdminActor();
  if (!actor) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { expectedVersion?: number };
  try {
    const banner = await archiveBanner(actor, { bannerId: params.id, expectedVersion: body.expectedVersion });
    return NextResponse.json(banner);
  } catch (err) {
    return adminErrorResponse(err);
  }
}
