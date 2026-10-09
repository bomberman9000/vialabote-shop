import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AdminActor } from "../actor";
import { authorizeAdmin } from "../authorize";
import { writeAuditLog } from "../audit";
import { AdminCommandError } from "../errors";

/**
 * Тот же OCC-паттерн, что и applyOptimisticUpdate для Product (см.
 * commands/product.ts) — updateMany с version в where, а не update(), т.к.
 * Prisma update() не умеет составной where без unique-индекса.
 */
async function applyOptimisticBannerUpdate(
  tx: Prisma.TransactionClient,
  bannerId: string,
  expectedVersion: number,
  data: Prisma.BannerUpdateManyMutationInput,
) {
  const result = await tx.banner.updateMany({
    where: { id: bannerId, version: expectedVersion },
    data: { ...data, version: { increment: 1 } },
  });
  if (result.count === 0) {
    const current = await tx.banner.findUnique({ where: { id: bannerId } });
    if (!current) throw new AdminCommandError("NOT_FOUND", "Баннер не найден");
    throw new AdminCommandError(
      "VERSION_CONFLICT",
      `Баннер изменился параллельно. Текущая версия: ${current.version}.`,
      { currentVersion: current.version },
    );
  }
  return tx.banner.findUniqueOrThrow({ where: { id: bannerId } });
}

// Только относительный путь или http(s) — блокирует javascript:/data:/vbscript:
// URI в CTA-ссылке (баннер виден всем покупателям на сторе).
const SAFE_URL = /^(\/[^\s]*|https?:\/\/[^\s]+)$/i;

const createBannerSchema = z.object({
  name: z.string().min(2).max(200),
  placement: z.string().min(1),
  desktopMediaId: z.string().min(1),
  mobileMediaId: z.string().min(1).optional(),
  headline: z.string().max(200).optional(),
  subheadline: z.string().max(300).optional(),
  ctaLabel: z.string().max(50).optional(),
  ctaUrl: z.string().max(500).regex(SAFE_URL, "ctaUrl должен быть относительным путём или http(s) URL").optional(),
});

async function assertMediaForPurpose(mediaId: string, expectedPurpose: "HERO_DESKTOP" | "HERO_MOBILE") {
  const media = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
  if (!media || media.validationState !== "valid") {
    throw new AdminCommandError("MEDIA_REJECTED", "Медиафайл не найден или не прошёл валидацию");
  }
  if (media.purpose !== expectedPurpose) {
    throw new AdminCommandError(
      "MEDIA_REJECTED",
      `Медиафайл провалидирован для "${media.purpose}", а не "${expectedPurpose}" — нельзя использовать в баннере как есть`,
    );
  }
}

export async function createBanner(actor: AdminActor, rawInput: unknown) {
  await authorizeAdmin(actor);
  const input = createBannerSchema.parse(rawInput);

  await assertMediaForPurpose(input.desktopMediaId, "HERO_DESKTOP");
  if (input.mobileMediaId) await assertMediaForPurpose(input.mobileMediaId, "HERO_MOBILE");

  return prisma.$transaction(async (tx) => {
    const banner = await tx.banner.create({
      data: { ...input, status: "draft", createdBy: actor.userId },
    });
    await writeAuditLog(tx, actor, {
      action: "CREATE_BANNER",
      entityType: "Banner",
      entityId: banner.id,
      before: null,
      after: banner,
    });
    return banner;
  });
}

const scheduleBannerSchema = z
  .object({
    bannerId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    startsAt: z.date().nullable(),
    endsAt: z.date().nullable(),
  })
  .refine((v) => !v.startsAt || !v.endsAt || v.startsAt <= v.endsAt, {
    message: "startsAt должен быть не позже endsAt — иначе баннер никогда не станет активным",
    path: ["endsAt"],
  });

/**
 * Явный конфликт расписаний вместо тихого "случайного" выбора баннера:
 * пересекающийся по времени published/scheduled баннер на том же placement
 * блокирует операцию, пока явно не изменят priority или период одного из них.
 */
async function assertNoScheduleConflict(
  placement: string,
  excludeBannerId: string,
  startsAt: Date | null,
  endsAt: Date | null,
) {
  const candidates = await prisma.banner.findMany({
    where: {
      placement,
      id: { not: excludeBannerId },
      status: { in: ["scheduled", "published"] },
    },
  });

  const newStart = startsAt?.getTime() ?? -Infinity;
  const newEnd = endsAt?.getTime() ?? Infinity;

  for (const other of candidates) {
    const otherStart = other.startsAt?.getTime() ?? -Infinity;
    const otherEnd = other.endsAt?.getTime() ?? Infinity;
    const overlaps = newStart <= otherEnd && otherStart <= newEnd;
    if (overlaps) {
      throw new AdminCommandError(
        "VALIDATION",
        `Конфликт расписания: баннер "${other.name}" уже занимает этот период на "${placement}". Измените priority или период.`,
        { conflictingBannerId: other.id },
      );
    }
  }
}

export async function scheduleBanner(actor: AdminActor, rawInput: unknown) {
  await authorizeAdmin(actor);
  const input = scheduleBannerSchema.parse(rawInput);

  const banner = await prisma.banner.findUnique({ where: { id: input.bannerId } });
  if (!banner) throw new AdminCommandError("NOT_FOUND", "Баннер не найден");
  if (banner.version !== input.expectedVersion) {
    throw new AdminCommandError(
      "VERSION_CONFLICT",
      `Баннер изменился параллельно. Текущая версия: ${banner.version}.`,
      { currentVersion: banner.version },
    );
  }

  await assertNoScheduleConflict(banner.placement, banner.id, input.startsAt, input.endsAt);

  return prisma.$transaction(async (tx) => {
    // Повторная проверка конфликта расписания ВНУТРИ транзакции — закрывает
    // TOCTOU-окно между pre-check выше и самой записью (две параллельные
    // schedule-команды на разные баннеры того же placement).
    await assertNoScheduleConflict(banner.placement, banner.id, input.startsAt, input.endsAt);
    const after = await applyOptimisticBannerUpdate(tx, input.bannerId, input.expectedVersion, {
      status: "scheduled",
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });
    await writeAuditLog(tx, actor, {
      action: "SCHEDULE_BANNER",
      entityType: "Banner",
      entityId: banner.id,
      before: { status: banner.status, startsAt: banner.startsAt, endsAt: banner.endsAt },
      after: { status: after.status, startsAt: after.startsAt, endsAt: after.endsAt },
    });
    return after;
  });
}

const bannerIdSchema = z.object({ bannerId: z.string().min(1), expectedVersion: z.number().int().positive() });

export async function publishBanner(actor: AdminActor, rawInput: unknown) {
  await authorizeAdmin(actor);
  const input = bannerIdSchema.parse(rawInput);
  const banner = await prisma.banner.findUnique({ where: { id: input.bannerId } });
  if (!banner) throw new AdminCommandError("NOT_FOUND", "Баннер не найден");
  if (banner.version !== input.expectedVersion) {
    throw new AdminCommandError(
      "VERSION_CONFLICT",
      `Баннер изменился параллельно. Текущая версия: ${banner.version}.`,
      { currentVersion: banner.version },
    );
  }

  await assertNoScheduleConflict(banner.placement, banner.id, banner.startsAt, banner.endsAt);

  return prisma.$transaction(async (tx) => {
    await assertNoScheduleConflict(banner.placement, banner.id, banner.startsAt, banner.endsAt);
    const after = await applyOptimisticBannerUpdate(tx, input.bannerId, input.expectedVersion, {
      status: "published",
    });
    await writeAuditLog(tx, actor, {
      action: "PUBLISH_BANNER",
      entityType: "Banner",
      entityId: banner.id,
      before: { status: banner.status },
      after: { status: after.status },
    });
    return after;
  });
}

export async function archiveBanner(actor: AdminActor, rawInput: unknown) {
  await authorizeAdmin(actor);
  const input = bannerIdSchema.parse(rawInput);
  const banner = await prisma.banner.findUnique({ where: { id: input.bannerId } });
  if (!banner) throw new AdminCommandError("NOT_FOUND", "Баннер не найден");
  if (banner.version !== input.expectedVersion) {
    throw new AdminCommandError(
      "VERSION_CONFLICT",
      `Баннер изменился параллельно. Текущая версия: ${banner.version}.`,
      { currentVersion: banner.version },
    );
  }

  return prisma.$transaction(async (tx) => {
    const after = await applyOptimisticBannerUpdate(tx, input.bannerId, input.expectedVersion, {
      status: "archived",
    });
    await writeAuditLog(tx, actor, {
      action: "ARCHIVE_BANNER",
      entityType: "Banner",
      entityId: banner.id,
      before: { status: banner.status },
      after: { status: after.status },
    });
    return after;
  });
}
