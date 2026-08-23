import { NextResponse } from "next/server";
import { getWebAdminActor, adminErrorResponse } from "@/lib/admin/api-response";
import { attachMedia } from "@/lib/admin/commands/media";
import { LocalMediaStorage } from "@/lib/media/local-storage";
import { MAX_UPLOAD_REQUEST_BYTES } from "@/lib/media/contracts";

const storage = new LocalMediaStorage();

// Загрузка медиа БЕЗ привязки к товару — для баннеров (HERO_DESKTOP/
// HERO_MOBILE/PROMO_BANNER/CATEGORY_TILE). Тот же attachMedia(), что и для
// товаров и для Telegram — единая точка contract validation -> storage ->
// MediaAsset.
export async function POST(req: Request) {
  const actor = await getWebAdminActor();
  if (!actor) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_UPLOAD_REQUEST_BYTES) {
    return NextResponse.json({ error: "VALIDATION", message: "Файл слишком большой" }, { status: 413 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const purpose = form.get("purpose");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "VALIDATION", message: "Файл не передан" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    const asset = await attachMedia(actor, storage, bytes, { purpose });
    return NextResponse.json(asset);
  } catch (err) {
    return adminErrorResponse(err);
  }
}
