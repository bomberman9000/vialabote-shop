import { NextResponse } from "next/server";
import { getWebAdminActor, adminErrorResponse } from "@/lib/admin/api-response";
import { publishProduct, archiveProduct, deleteProduct, updateProduct } from "@/lib/admin/commands/product";

// Раньше здесь была прямая mass-assignment запись в Prisma (см. Phase 1
// audit): произвольные поля из body писались в БД без Zod, без audit, без
// concurrency-контроля. Теперь — как и Telegram — этот route идёт ТОЛЬКО
// через типизированный Admin Command Layer (src/lib/admin/commands/*):
// authenticate -> authorize (перепроверяется внутри команды) -> validate ->
// application service (транзакция) -> audit -> typed result.

const LIFECYCLE_ACTIONS = ["publish", "archive"] as const;

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const actor = await getWebAdminActor();
  if (!actor) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json();
  const { action, expectedVersion, ...rest } = body as {
    action?: string;
    expectedVersion?: number;
    [key: string]: unknown;
  };

  if (typeof expectedVersion !== "number") {
    return NextResponse.json(
      { error: "VALIDATION", message: "expectedVersion обязателен — используйте актуальную версию товара" },
      { status: 400 },
    );
  }

  try {
    if (action === "update") {
      const product = await updateProduct(actor, { productId: params.id, expectedVersion, ...rest });
      return NextResponse.json(product);
    }
    if ((LIFECYCLE_ACTIONS as readonly string[]).includes(action ?? "")) {
      const product =
        action === "publish"
          ? await publishProduct(actor, { productId: params.id, expectedVersion })
          : await archiveProduct(actor, { productId: params.id, expectedVersion });
      return NextResponse.json(product);
    }
    return NextResponse.json(
      { error: "VALIDATION", message: 'action должен быть "publish", "archive" или "update"' },
      { status: 400 },
    );
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const actor = await getWebAdminActor();
  if (!actor) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { expectedVersion } = body as { expectedVersion?: number };
  if (typeof expectedVersion !== "number") {
    return NextResponse.json(
      { error: "VALIDATION", message: "expectedVersion обязателен — используйте актуальную версию товара" },
      { status: 400 },
    );
  }

  try {
    const result = await deleteProduct(actor, { productId: params.id, expectedVersion });
    return NextResponse.json(result);
  } catch (err) {
    return adminErrorResponse(err);
  }
}
