// @vitest-environment node
// updateProduct на настоящем PostgreSQL: новые поля карточки, смена категории, остаток только через журнал.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { updateProduct } from "./product";
import { AdminCommandError } from "../errors";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let adminId = "";
let productId = "";
const categoryIds: string[] = [];

describe.skipIf(!HAS_DB)("updateProduct — card fields (DB)", () => {
  beforeAll(async () => {
    adminId = (await prisma.user.create({ data: { email: `card-${suffix}@example.com`, passwordHash: "x", role: "ADMIN" } })).id;
    for (const n of ["a", "b"]) categoryIds.push((await prisma.category.create({ data: { name: `Card ${suffix} ${n}`, slug: `card-${suffix}-${n}` } })).id);
    productId = (
      await prisma.product.create({ data: { title: `Card ${suffix}`, slug: `card-${suffix}`, description: "", price: 1000, imageUrl: "/x.png", stock: 4, categoryId: categoryIds[0] } })
    ).id;
  });
  afterAll(async () => {
    await prisma.stockChangeLog.deleteMany({ where: { productId } });
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
    await prisma.user.deleteMany({ where: { id: adminId } });
  });
  const actor = () => ({ userId: adminId, source: "WEB_ADMIN" as const });
  const version = async () => (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).version;

  it("writes warnings, shelfLife, manufacturer, howToUse and category", async () => {
    const after = await updateProduct(actor(), {
      productId,
      expectedVersion: await version(),
      warnings: "Только наружно",
      shelfLife: "24 месяца, после вскрытия 12",
      manufacturer: "ООО «БОТЭ», Россия",
      howToUse: "Нанести на кожу",
      categoryId: categoryIds[1],
    });
    expect(after).toMatchObject({ warnings: "Только наружно", shelfLife: "24 месяца, после вскрытия 12", manufacturer: "ООО «БОТЭ», Россия", categoryId: categoryIds[1] });
  });

  it("unknown category -> NOT_FOUND, nothing changed", async () => {
    const v = await version();
    await expect(updateProduct(actor(), { productId, expectedVersion: v, categoryId: "nope" })).rejects.toBeInstanceOf(AdminCommandError);
    expect(await version()).toBe(v);
  });

  it("stock via updateProduct goes through the stock journal (ADJUST, WEB_ADMIN) together with other fields", async () => {
    const after = await updateProduct(actor(), { productId, expectedVersion: await version(), stock: 9, manufacturer: "Новый" });
    expect(after).toMatchObject({ stock: 9, manufacturer: "Новый" });
    const rows = await prisma.stockChangeLog.findMany({ where: { productId } });
    expect(rows.map((r) => [r.reason, r.oldStock, r.newStock, r.source, r.actorUserId])).toEqual([["ADJUST", 4, 9, "WEB_ADMIN", adminId]]);
  });

  it("stale version: neither stock nor fields change", async () => {
    const v = await version();
    await expect(updateProduct(actor(), { productId, expectedVersion: v - 1, stock: 1, manufacturer: "X" })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(p).toMatchObject({ stock: 9, manufacturer: "Новый", version: v });
    expect(await prisma.stockChangeLog.count({ where: { productId } })).toBe(1);
  });
});
