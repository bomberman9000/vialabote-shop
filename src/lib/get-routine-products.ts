import { prisma } from "@/lib/prisma";
import type { RoutineProduct } from "@/lib/routine-engine";

// Серверная выборка товаров с тегами Routine Finder — источник истины для
// клиентского движка подбора (никаких данных не додумывается на клиенте).
export async function getRoutineProducts(): Promise<RoutineProduct[]> {
  const products = await prisma.product.findMany({
    where: { isActive: true, routineRole: { not: null } },
    include: {
      concerns: { include: { concern: true } },
      skinTypes: { include: { skinType: true } },
    },
  });

  return products.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    price: p.price,
    imageUrl: p.imageUrl,
    stock: p.stock,
    concernSlugs: p.concerns.map((c) => c.concern.slug),
    skinTypeSlugs: p.skinTypes.map((s) => s.skinType.slug),
    routineStep: p.routineStep,
    routineRole: p.routineRole,
  }));
}
