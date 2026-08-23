import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function assertAdmin() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "ADMIN") {
    throw new Response("Forbidden", { status: 403 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    await assertAdmin();
  } catch (res) {
    return res as Response;
  }

  const body = await req.json();
  const product = await prisma.product.update({
    where: { id: params.id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.price !== undefined ? { price: body.price } : {}),
      ...(body.stock !== undefined ? { stock: body.stock } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
    },
  });

  return NextResponse.json(product);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    await assertAdmin();
  } catch (res) {
    return res as Response;
  }

  await prisma.product.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
