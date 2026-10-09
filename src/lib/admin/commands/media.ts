import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { AdminActor } from "../actor";
import { authorizeAdmin } from "../authorize";
import { writeAuditLog } from "../audit";
import { AdminCommandError } from "../errors";
import { validateMedia } from "@/lib/media/validator";
import { isMediaPurpose, type MediaPurpose } from "@/lib/media/contracts";
import { extensionForMime } from "@/lib/media/local-storage";
import type { MediaStorage } from "@/lib/media/storage";

const attachMediaSchema = z.object({
  purpose: z.string().refine(isMediaPurpose, "Неизвестный media purpose"),
  productId: z.string().min(1).optional(),
  isPrimary: z.boolean().default(false),
});

// Purpose должен быть согласован с тем, куда медиа реально прикрепляется —
// иначе можно провалидировать 16:9 hero-баннер и прикрепить его как
// PRODUCT_PRIMARY (или наоборот) в обход смысла per-purpose media contract,
// даже если сами байты честно прошли валидацию под СВОЙ formal purpose.
const PRODUCT_PURPOSES: readonly MediaPurpose[] = ["PRODUCT_PRIMARY", "PRODUCT_GALLERY"];

/**
 * Единая точка приёма файла для Web Admin И Telegram — оба вызывают ровно
 * этот command с сырыми байтами. Никакой отдельной Telegram-валидации.
 */
export async function attachMedia(
  actor: AdminActor,
  storage: MediaStorage,
  bytes: Uint8Array,
  rawInput: unknown,
) {
  await authorizeAdmin(actor);
  const input = attachMediaSchema.parse(rawInput);
  const purpose = input.purpose as MediaPurpose;

  if (input.productId) {
    const product = await prisma.product.findUnique({ where: { id: input.productId } });
    if (!product) throw new AdminCommandError("NOT_FOUND", "Товар не найден");
    if (!PRODUCT_PURPOSES.includes(purpose)) {
      throw new AdminCommandError(
        "VALIDATION",
        `Purpose "${purpose}" нельзя прикрепить к товару — допустимы: ${PRODUCT_PURPOSES.join(", ")}`,
      );
    }
  } else if (PRODUCT_PURPOSES.includes(purpose)) {
    throw new AdminCommandError(
      "VALIDATION",
      `Purpose "${purpose}" требует productId — для баннеров/категорий используйте HERO_DESKTOP, HERO_MOBILE, CATEGORY_TILE или PROMO_BANNER`,
    );
  }

  const validation = validateMedia(bytes, purpose);
  if (!validation.valid) {
    throw new AdminCommandError("MEDIA_REJECTED", "Изображение отклонено", {
      reasons: validation.reasons,
      assistSuggestion: validation.assistSuggestion,
    });
  }

  const extension = extensionForMime(validation.mimeType);
  const stored = await storage.save(bytes, extension);

  return prisma.$transaction(async (tx) => {
    if (input.isPrimary && input.productId) {
      await tx.mediaAsset.updateMany({
        where: { productId: input.productId, purpose },
        data: { isPrimary: false },
      });
    }

    const asset = await tx.mediaAsset.create({
      data: {
        purpose,
        url: stored.url,
        storageKey: stored.storageKey,
        width: validation.width,
        height: validation.height,
        mimeType: validation.mimeType,
        sizeBytes: validation.sizeBytes,
        validationState: "valid",
        isPrimary: input.isPrimary,
        productId: input.productId ?? null,
        createdBy: actor.userId,
      },
    });

    if (input.isPrimary && input.productId) {
      await tx.product.update({ where: { id: input.productId }, data: { imageUrl: stored.url } });
    }

    await writeAuditLog(tx, actor, {
      action: "ATTACH_MEDIA",
      entityType: "MediaAsset",
      entityId: asset.id,
      before: null,
      after: asset,
    });

    return asset;
  });
}

const setPrimaryMediaSchema = z.object({
  mediaId: z.string().min(1),
});

export async function setPrimaryMedia(actor: AdminActor, rawInput: unknown) {
  await authorizeAdmin(actor);
  const input = setPrimaryMediaSchema.parse(rawInput);

  const asset = await prisma.mediaAsset.findUnique({ where: { id: input.mediaId } });
  if (!asset) throw new AdminCommandError("NOT_FOUND", "Медиафайл не найден");
  if (!asset.productId) throw new AdminCommandError("VALIDATION", "Медиафайл не привязан к товару");

  return prisma.$transaction(async (tx) => {
    await tx.mediaAsset.updateMany({
      where: { productId: asset.productId!, purpose: asset.purpose },
      data: { isPrimary: false },
    });
    const after = await tx.mediaAsset.update({ where: { id: asset.id }, data: { isPrimary: true } });
    await tx.product.update({ where: { id: asset.productId! }, data: { imageUrl: asset.url } });
    await writeAuditLog(tx, actor, {
      action: "SET_PRIMARY_MEDIA",
      entityType: "MediaAsset",
      entityId: asset.id,
      before: { isPrimary: asset.isPrimary },
      after: { isPrimary: after.isPrimary },
    });
    return after;
  });
}

const removeMediaSchema = z.object({
  mediaId: z.string().min(1),
});

export async function removeMedia(actor: AdminActor, storage: MediaStorage, rawInput: unknown) {
  await authorizeAdmin(actor);
  const input = removeMediaSchema.parse(rawInput);

  const asset = await prisma.mediaAsset.findUnique({ where: { id: input.mediaId } });
  if (!asset) throw new AdminCommandError("NOT_FOUND", "Медиафайл не найден");

  // Явная проверка ДО удаления — иначе FK constraint (Banner.desktopMediaId/
  // mobileMediaId -> MediaAsset) кидает сырую Prisma-ошибку вместо понятного
  // сообщения (тот же класс проблемы, что и deleteProduct с заказами).
  const referencingBanners = await prisma.banner.findMany({
    where: { OR: [{ desktopMediaId: asset.id }, { mobileMediaId: asset.id }] },
    select: { id: true, name: true },
  });
  if (referencingBanners.length > 0) {
    throw new AdminCommandError(
      "VALIDATION",
      `Медиафайл используется в баннере "${referencingBanners[0].name}" — сначала уберите его оттуда`,
      { bannerIds: referencingBanners.map((b) => b.id) },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.mediaAsset.delete({ where: { id: asset.id } });
    await writeAuditLog(tx, actor, {
      action: "REMOVE_MEDIA",
      entityType: "MediaAsset",
      entityId: asset.id,
      before: asset,
      after: null,
    });
  });

  await storage.delete(asset.storageKey);
  return { ok: true };
}
