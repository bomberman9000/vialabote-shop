import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWebAdminActor, adminErrorResponse } from "@/lib/admin/api-response";
import { createBanner } from "@/lib/admin/commands/banner";

export async function GET() {
  const actor = await getWebAdminActor();
  if (!actor) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const banners = await prisma.banner.findMany({
    orderBy: { createdAt: "desc" },
    include: { desktopMedia: true, mobileMedia: true },
  });
  return NextResponse.json(banners);
}

export async function POST(req: Request) {
  const actor = await getWebAdminActor();
  if (!actor) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json();
  try {
    const banner = await createBanner(actor, body);
    return NextResponse.json(banner);
  } catch (err) {
    return adminErrorResponse(err);
  }
}
