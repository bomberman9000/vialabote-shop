// Parity check after the SQLite -> Postgres move: compares the catalog in the
// database at DATABASE_URL with prisma/catalog-snapshot.json (exported from
// the last SQLite dev.db). Read-only. Exit 1 on any difference.
//
// usage: npx tsx scripts/db/verify-catalog.ts [snapshot.json]
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

type Row = Record<string, unknown>;

async function main() {
  const file = process.argv[2] ?? "prisma/catalog-snapshot.json";
  const expected: Row[] = JSON.parse(fs.readFileSync(file, "utf8")).products;
  const prisma = new PrismaClient();
  try {
    const products = await prisma.product.findMany({
      include: {
        category: true,
        concerns: { include: { concern: true } },
        skinTypes: { include: { skinType: true } },
        media: { where: { purpose: "PRODUCT_GALLERY" }, orderBy: [{ order: "asc" }, { url: "asc" }] },
      },
      orderBy: { slug: "asc" },
    });
    const actual: Row[] = products.map((p) => ({
      slug: p.slug,
      title: p.title,
      subtitle: p.subtitle,
      description: p.description,
      activeIngredients: p.activeIngredients,
      howToUse: p.howToUse,
      volume: p.volume,
      badge: p.badge,
      price: p.price,
      oldPrice: p.oldPrice,
      imageUrl: p.imageUrl,
      stock: p.stock,
      status: p.status,
      isActive: p.isActive,
      featured: p.featured,
      displayOrder: p.displayOrder,
      routineStep: p.routineStep,
      routineRole: p.routineRole,
      categorySlug: p.category.slug,
      categoryName: p.category.name,
      concerns: p.concerns.map((c) => c.concern.slug).sort(),
      skinTypes: p.skinTypes.map((s) => s.skinType.slug).sort(),
      gallery: p.media.map((m) => m.url),
    }));

    const diffs: string[] = [];
    const bySlug = new Map(actual.map((r) => [r.slug as string, r]));
    for (const exp of expected) {
      const act = bySlug.get(exp.slug as string);
      if (!act) {
        diffs.push(`missing product ${exp.slug}`);
        continue;
      }
      for (const key of Object.keys(exp)) {
        if (JSON.stringify(exp[key]) !== JSON.stringify(act[key])) {
          diffs.push(`${exp.slug}.${key}: expected ${JSON.stringify(exp[key])} got ${JSON.stringify(act[key])}`);
        }
      }
      bySlug.delete(exp.slug as string);
    }
    for (const extra of bySlug.keys()) diffs.push(`unexpected product ${extra}`);

    if (diffs.length) {
      console.log(`CATALOG_PARITY=FAIL (${diffs.length} differences)`);
      diffs.slice(0, 40).forEach((d) => console.log("  " + d));
      process.exitCode = 1;
    } else {
      console.log(`CATALOG_PARITY=PASS (${expected.length} products, every field identical)`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main();
