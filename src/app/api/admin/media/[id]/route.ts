import { NextResponse } from "next/server";
import { getWebAdminActor, adminErrorResponse } from "@/lib/admin/api-response";
import { setPrimaryMedia, removeMedia } from "@/lib/admin/commands/media";
import { LocalMediaStorage } from "@/lib/media/local-storage";

const storage = new LocalMediaStorage();

export async function PATCH(_req: Request, { params }: { params: { id: string } }) {
  const actor = await getWebAdminActor();
  if (!actor) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  try {
    const asset = await setPrimaryMedia(actor, { mediaId: params.id });
    return NextResponse.json(asset);
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const actor = await getWebAdminActor();
  if (!actor) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  try {
    const result = await removeMedia(actor, storage, { mediaId: params.id });
    return NextResponse.json(result);
  } catch (err) {
    return adminErrorResponse(err);
  }
}
