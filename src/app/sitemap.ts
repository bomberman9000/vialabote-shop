import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { SITE_URL } from "@/lib/share-image";

// Список страниц для Яндекса и Google: все опубликованные товары и публичные разделы. Обновляется раз в час.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await prisma.product.findMany({
    where: { status: "published", isActive: true },
    select: { slug: true, updatedAt: true },
    orderBy: { createdAt: "asc" },
  });
  const latest = products.reduce<Date | undefined>((m, p) => (!m || p.updatedAt > m ? p.updatedAt : m), undefined);
  return [
    { url: SITE_URL, lastModified: latest, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/catalog`, lastModified: latest, changeFrequency: "daily", priority: 0.9 },
    ...products.map((p) => ({
      url: `${SITE_URL}/product/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...["/returns", "/offer", "/privacy"].map((path) => ({ url: `${SITE_URL}${path}`, changeFrequency: "yearly" as const, priority: 0.3 })),
  ];
}
