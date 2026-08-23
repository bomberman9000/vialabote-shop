import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const schema = z.object({
  title: z.string().min(2),
  slug: z.string().min(2),
  description: z.string().default(""),
  price: z.number().int().positive(),
  oldPrice: z.number().int().positive().optional().nullable(),
  imageUrl: z.string().min(1),
  stock: z.number().int().min(0),
  categorySlug: z.string().min(1),
  categoryName: z.string().min(1),
  isActive: z.boolean().default(true),
});

async function assertAdmin() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "ADMIN") {
    throw new Response("Forbidden", { status: 403 });
  }
}

export async function POST(req: Request) {
  try {
    await assertAdmin();
  } catch (res) {
    return res as Response;
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const category = await prisma.category.upsert({
    where: { slug: data.categorySlug },
    update: {},
    create: { slug: data.categorySlug, name: data.categoryName },
  });

  const product = await prisma.product.create({
    data: {
      title: data.title,
      slug: data.slug,
      description: data.description,
      price: data.price,
      oldPrice: data.oldPrice ?? null,
      imageUrl: data.imageUrl,
      stock: data.stock,
      isActive: data.isActive,
      categoryId: category.id,
    },
  });

  return NextResponse.json(product);
}
