import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getWebAdminActor, adminErrorResponse } from "@/lib/admin/api-response";
import { createProduct, publishProduct } from "@/lib/admin/commands/product";

// Категория — не часть типизированного Admin Command Layer (никогда не
// участвует в price/lifecycle-логике), поэтому upsert по slug остаётся
// прямой Prisma-операцией. Сам Product — ТОЛЬКО через createProduct(),
// как и Telegram/Web Admin остальные мутации. Картинка не задаётся здесь:
// путь — создать (draft, placeholder) -> AttachMedia -> опубликовать.
const schema = z.object({
  title: z.string().min(2),
  slug: z.string().min(2),
  description: z.string().default(""),
  price: z.number().int().positive(),
  stock: z.number().int().min(0).default(0),
  categorySlug: z.string().min(1),
  categoryName: z.string().min(1),
  publish: z.boolean().default(false),
});

export async function POST(req: Request) {
  const actor = await getWebAdminActor();
  if (!actor) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

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

  try {
    let product = await createProduct(actor, {
      title: data.title,
      slug: data.slug,
      description: data.description,
      price: data.price,
      stock: data.stock,
      categoryId: category.id,
    });

    if (data.publish) {
      product = await publishProduct(actor, { productId: product.id, expectedVersion: product.version });
    }

    return NextResponse.json(product);
  } catch (err) {
    return adminErrorResponse(err);
  }
}
