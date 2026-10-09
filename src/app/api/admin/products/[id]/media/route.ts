import { NextResponse } from "next/server";
import { getWebAdminActor, adminErrorResponse } from "@/lib/admin/api-response";
import { attachMedia } from "@/lib/admin/commands/media";
import { LocalMediaStorage } from "@/lib/media/local-storage";
import { MAX_UPLOAD_REQUEST_BYTES } from "@/lib/media/contracts";

const storage = new LocalMediaStorage();

// Multipart upload: file bytes идут через validateMedia() (contract
// validation — MIME sniffing из содержимого, размеры, aspect ratio) ДО
// storage.save(), а storage.save() — ДО создания MediaAsset/attach/publish.
// Порядок жёстко зафиксирован внутри attachMedia() самого command layer,
// этот route лишь достаёт bytes из FormData и передаёт их дальше — той же
// функции, которую вызывает и Telegram.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const actor = await getWebAdminActor();
  if (!actor) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  // Content-Length ДО req.formData() — не буферизуем в память запрос,
  // заведомо превышающий любой per-purpose контракт (см. MAX_UPLOAD_REQUEST_BYTES).
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_UPLOAD_REQUEST_BYTES) {
    return NextResponse.json({ error: "VALIDATION", message: "Файл слишком большой" }, { status: 413 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const purpose = form.get("purpose");
  const isPrimary = form.get("isPrimary") === "true";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "VALIDATION", message: "Файл не передан" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    const asset = await attachMedia(actor, storage, bytes, {
      purpose,
      productId: params.id,
      isPrimary,
    });
    return NextResponse.json(asset);
  } catch (err) {
    return adminErrorResponse(err);
  }
}
