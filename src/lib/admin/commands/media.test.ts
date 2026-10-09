import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { attachMedia, setPrimaryMedia, removeMedia } from "./media";
import { LocalMediaStorage } from "@/lib/media/local-storage";
import { makeJpegBytes, makePngBytes } from "@/lib/media/test-fixtures";
import { AdminCommandError } from "../errors";

const storage = new LocalMediaStorage();
let adminUserId: string;
let categoryId: string;
let productId: string;
const mediaIds: string[] = [];

beforeAll(async () => {
  const category = await prisma.category.create({
    data: { name: "TEST-Media", slug: `test-media-${Date.now()}` },
  });
  categoryId = category.id;

  const admin = await prisma.user.create({
    data: { email: `test-media-admin-${Date.now()}@example.com`, passwordHash: "x", role: "ADMIN" },
  });
  adminUserId = admin.id;

  const product = await prisma.product.create({
    data: {
      title: "Media test product",
      slug: `media-test-${Date.now()}`,
      description: "",
      price: 10000,
      imageUrl: "/images/placeholder.svg",
      categoryId,
    },
  });
  productId = product.id;
});

afterAll(async () => {
  for (const id of mediaIds) {
    const asset = await prisma.mediaAsset.findUnique({ where: { id } });
    if (asset) await storage.delete(asset.storageKey).catch(() => {});
  }
  await prisma.mediaAsset.deleteMany({ where: { productId } });
  await prisma.auditLog.deleteMany({ where: { actorId: adminUserId } });
  await prisma.product.delete({ where: { id: productId } });
  await prisma.category.delete({ where: { id: categoryId } });
  await prisma.user.delete({ where: { id: adminUserId } });
});

describe("attachMedia — единая точка для Web Admin и Telegram", () => {
  it("валидное изображение проходит validate -> store -> DB record", async () => {
    const bytes = makePngBytes(1600, 1600);
    const asset = await attachMedia({ userId: adminUserId, source: "WEB_ADMIN" }, storage, bytes, {
      purpose: "PRODUCT_PRIMARY",
      productId,
      isPrimary: true,
    });
    mediaIds.push(asset.id);

    expect(asset.validationState).toBe("valid");
    expect(asset.width).toBe(1600);
    expect(asset.height).toBe(1600);
    expect(asset.isPrimary).toBe(true);

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.imageUrl).toBe(asset.url);
  });

  it("невалидное изображение отклоняется ДО сохранения в storage/DB (reject, не CSS-stretch)", async () => {
    const bytes = makeJpegBytes(400, 400); // меньше минимума для PRODUCT_PRIMARY
    await expect(
      attachMedia({ userId: adminUserId, source: "TELEGRAM" }, storage, bytes, {
        purpose: "PRODUCT_PRIMARY",
        productId,
      }),
    ).rejects.toMatchObject({ code: "MEDIA_REJECTED" });

    const countAfter = await prisma.mediaAsset.count({ where: { productId } });
    expect(countAfter).toBe(1); // не выросло — второй (битый) не сохранился
  });

  it("не-админ не может загружать медиа", async () => {
    const customer = await prisma.user.create({
      data: { email: `test-media-customer-${Date.now()}@example.com`, passwordHash: "x", role: "CUSTOMER" },
    });
    await expect(
      attachMedia({ userId: customer.id, source: "WEB_ADMIN" }, storage, makePngBytes(1600, 1600), {
        purpose: "PRODUCT_PRIMARY",
        productId,
      }),
    ).rejects.toThrow(AdminCommandError);
    await prisma.user.delete({ where: { id: customer.id } });
  });

  it("неизвестный purpose отклоняется валидацией", async () => {
    await expect(
      attachMedia({ userId: adminUserId, source: "WEB_ADMIN" }, storage, makePngBytes(1600, 1600), {
        purpose: "NOT_A_REAL_PURPOSE",
        productId,
      }),
    ).rejects.toThrow();
  });
});

describe("setPrimaryMedia / removeMedia", () => {
  it("назначает другое медиа primary, снимая флаг с предыдущего", async () => {
    const bytes1 = makePngBytes(1600, 1600);
    const asset1 = await attachMedia({ userId: adminUserId, source: "WEB_ADMIN" }, storage, bytes1, {
      purpose: "PRODUCT_GALLERY",
      productId,
      isPrimary: false,
    });
    mediaIds.push(asset1.id);

    const bytes2 = makePngBytes(1600, 1600);
    const asset2 = await attachMedia({ userId: adminUserId, source: "WEB_ADMIN" }, storage, bytes2, {
      purpose: "PRODUCT_GALLERY",
      productId,
      isPrimary: false,
    });
    mediaIds.push(asset2.id);

    await setPrimaryMedia({ userId: adminUserId, source: "WEB_ADMIN" }, { mediaId: asset1.id });
    const updated1 = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset1.id } });
    expect(updated1.isPrimary).toBe(true);

    await setPrimaryMedia({ userId: adminUserId, source: "WEB_ADMIN" }, { mediaId: asset2.id });
    const reChecked1 = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset1.id } });
    const updated2 = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset2.id } });
    expect(reChecked1.isPrimary).toBe(false);
    expect(updated2.isPrimary).toBe(true);
  });

  it("removeMedia удаляет из БД и из storage", async () => {
    const bytes = makePngBytes(1600, 1600);
    const asset = await attachMedia({ userId: adminUserId, source: "WEB_ADMIN" }, storage, bytes, {
      purpose: "PRODUCT_GALLERY",
      productId,
      isPrimary: false,
    });

    await removeMedia({ userId: adminUserId, source: "WEB_ADMIN" }, storage, { mediaId: asset.id });

    const gone = await prisma.mediaAsset.findUnique({ where: { id: asset.id } });
    expect(gone).toBeNull();
  });

  it("несуществующий mediaId -> NOT_FOUND", async () => {
    await expect(
      setPrimaryMedia({ userId: adminUserId, source: "WEB_ADMIN" }, { mediaId: "does-not-exist" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("attachMedia — purpose должен быть согласован с контекстом (security review finding)", () => {
  it("товарный purpose (PRODUCT_PRIMARY) без productId отклоняется", async () => {
    await expect(
      attachMedia({ userId: adminUserId, source: "WEB_ADMIN" }, storage, makePngBytes(1600, 1600), {
        purpose: "PRODUCT_PRIMARY",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("баннерный purpose (HERO_DESKTOP) с productId отклоняется — нельзя прикрепить 16:9 hero как фото товара", async () => {
    const bytes = makeJpegBytes(1920, 1080);
    await expect(
      attachMedia({ userId: adminUserId, source: "WEB_ADMIN" }, storage, bytes, {
        purpose: "HERO_DESKTOP",
        productId,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("removeMedia — не удаляет медиа, используемое в баннере (security review finding)", () => {
  it("медиа, привязанное к баннеру, не удаляется — понятная ошибка вместо сырого FK exception", async () => {
    const bytes = makeJpegBytes(1920, 1080);
    const asset = await attachMedia({ userId: adminUserId, source: "WEB_ADMIN" }, storage, bytes, {
      purpose: "HERO_DESKTOP",
    });

    const { createBanner, archiveBanner } = await import("./banner");
    const banner = await createBanner(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { name: "Media removal guard test", placement: `TEST_MEDIA_GUARD_${Date.now()}`, desktopMediaId: asset.id },
    );

    await expect(
      removeMedia({ userId: adminUserId, source: "WEB_ADMIN" }, storage, { mediaId: asset.id }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    const stillThere = await prisma.mediaAsset.findUnique({ where: { id: asset.id } });
    expect(stillThere).not.toBeNull();

    // cleanup
    await prisma.auditLog.deleteMany({ where: { entityId: banner.id } });
    await prisma.banner.delete({ where: { id: banner.id } });
    await removeMedia({ userId: adminUserId, source: "WEB_ADMIN" }, storage, { mediaId: asset.id });
  });
});
