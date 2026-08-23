import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createBanner, scheduleBanner, publishBanner, archiveBanner } from "./banner";
import { AdminCommandError } from "../errors";

let adminUserId: string;
let mediaId: string;
const bannerIds: string[] = [];
const placement = `TEST_PLACEMENT_${Date.now()}`;

beforeAll(async () => {
  const admin = await prisma.user.create({
    data: { email: `test-banner-admin-${Date.now()}@example.com`, passwordHash: "x", role: "ADMIN" },
  });
  adminUserId = admin.id;

  const media = await prisma.mediaAsset.create({
    data: {
      purpose: "HERO_DESKTOP",
      url: "/uploads/media/test-fixture.jpg",
      storageKey: `test-fixture-${Date.now()}.jpg`,
      width: 1920,
      height: 1080,
      mimeType: "image/jpeg",
      sizeBytes: 100000,
      validationState: "valid",
      createdBy: adminUserId,
    },
  });
  mediaId = media.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: bannerIds } } });
  await prisma.banner.deleteMany({ where: { id: { in: bannerIds } } });
  await prisma.mediaAsset.delete({ where: { id: mediaId } });
  await prisma.user.delete({ where: { id: adminUserId } });
});

describe("createBanner", () => {
  it("создаёт баннер в статусе draft со ссылкой на валидное медиа", async () => {
    const banner = await createBanner(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { name: "Test Banner", placement, desktopMediaId: mediaId },
    );
    bannerIds.push(banner.id);
    expect(banner.status).toBe("draft");
  });

  it("отклоняет ссылку на несуществующее медиа", async () => {
    await expect(
      createBanner(
        { userId: adminUserId, source: "WEB_ADMIN" },
        { name: "Bad Banner", placement, desktopMediaId: "does-not-exist" },
      ),
    ).rejects.toMatchObject({ code: "MEDIA_REJECTED" });
  });
});

describe("scheduleBanner / publishBanner — конфликт расписания детерминирован", () => {
  it("два непересекающихся периода на одном placement — оба проходят", async () => {
    const bannerA = await createBanner(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { name: "Banner A", placement, desktopMediaId: mediaId },
    );
    bannerIds.push(bannerA.id);
    const bannerB = await createBanner(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { name: "Banner B", placement, desktopMediaId: mediaId },
    );
    bannerIds.push(bannerB.id);

    await scheduleBanner(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { bannerId: bannerA.id, expectedVersion: 1, startsAt: new Date("2026-09-01"), endsAt: new Date("2026-09-10") },
    );
    await scheduleBanner(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { bannerId: bannerB.id, expectedVersion: 1, startsAt: new Date("2026-09-11"), endsAt: new Date("2026-09-20") },
    );

    const a = await prisma.banner.findUniqueOrThrow({ where: { id: bannerA.id } });
    const b = await prisma.banner.findUniqueOrThrow({ where: { id: bannerB.id } });
    expect(a.status).toBe("scheduled");
    expect(b.status).toBe("scheduled");
  });

  it("пересекающиеся периоды на одном placement — explicit reject, не тихий случайный выбор", async () => {
    const bannerC = await createBanner(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { name: "Banner C", placement, desktopMediaId: mediaId },
    );
    bannerIds.push(bannerC.id);
    await scheduleBanner(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { bannerId: bannerC.id, expectedVersion: 1, startsAt: new Date("2026-10-01"), endsAt: new Date("2026-10-10") },
    );

    const bannerD = await createBanner(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { name: "Banner D", placement, desktopMediaId: mediaId },
    );
    bannerIds.push(bannerD.id);

    await expect(
      scheduleBanner(
        { userId: adminUserId, source: "WEB_ADMIN" },
        { bannerId: bannerD.id, expectedVersion: 1, startsAt: new Date("2026-10-05"), endsAt: new Date("2026-10-15") }, // пересекается
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    const d = await prisma.banner.findUniqueOrThrow({ where: { id: bannerD.id } });
    expect(d.status).toBe("draft"); // не перешёл в scheduled молча
  });

  it("archiveBanner переводит в archived и пишет audit", async () => {
    const banner = await createBanner(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { name: "To Archive", placement: `${placement}_solo`, desktopMediaId: mediaId },
    );
    bannerIds.push(banner.id);
    await publishBanner({ userId: adminUserId, source: "WEB_ADMIN" }, { bannerId: banner.id, expectedVersion: 1 });
    const archived = await archiveBanner(
      { userId: adminUserId, source: "TELEGRAM" },
      { bannerId: banner.id, expectedVersion: 2 },
    );
    expect(archived.status).toBe("archived");

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: banner.id, action: "ARCHIVE_BANNER" },
    });
    expect(audit).toBeTruthy();
    expect(audit!.source).toBe("TELEGRAM");
  });
});

describe("banner commands — authorization", () => {
  it("не-админ не может создать баннер", async () => {
    const customer = await prisma.user.create({
      data: { email: `test-banner-customer-${Date.now()}@example.com`, passwordHash: "x", role: "CUSTOMER" },
    });
    await expect(
      createBanner(
        { userId: customer.id, source: "WEB_ADMIN" },
        { name: "Hacked Banner", placement, desktopMediaId: mediaId },
      ),
    ).rejects.toThrow(AdminCommandError);
    await prisma.user.delete({ where: { id: customer.id } });
  });
});

describe("createBanner — media purpose должен совпадать (security review finding)", () => {
  it("медиа с purpose PRODUCT_PRIMARY нельзя использовать как desktopMediaId", async () => {
    const wrongMedia = await prisma.mediaAsset.create({
      data: {
        purpose: "PRODUCT_PRIMARY",
        url: "/uploads/media/wrong-purpose.jpg",
        storageKey: `wrong-purpose-${Date.now()}.jpg`,
        width: 1600,
        height: 1600,
        mimeType: "image/jpeg",
        sizeBytes: 50000,
        validationState: "valid",
        createdBy: adminUserId,
      },
    });

    await expect(
      createBanner(
        { userId: adminUserId, source: "WEB_ADMIN" },
        { name: "Wrong Purpose Banner", placement: `${placement}_wrong`, desktopMediaId: wrongMedia.id },
      ),
    ).rejects.toMatchObject({ code: "MEDIA_REJECTED" });

    await prisma.mediaAsset.delete({ where: { id: wrongMedia.id } });
  });

  it("ctaUrl с javascript: схемой отклоняется", async () => {
    await expect(
      createBanner(
        { userId: adminUserId, source: "WEB_ADMIN" },
        {
          name: "XSS Banner",
          placement: `${placement}_xss`,
          desktopMediaId: mediaId,
          ctaUrl: "javascript:alert(1)",
        },
      ),
    ).rejects.toThrow();
  });
});

describe("scheduleBanner — startsAt должен быть не позже endsAt (security review finding)", () => {
  it("startsAt > endsAt отклоняется валидацией", async () => {
    const banner = await createBanner(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { name: "Bad Schedule Banner", placement: `${placement}_badsched`, desktopMediaId: mediaId },
    );
    bannerIds.push(banner.id);

    await expect(
      scheduleBanner(
        { userId: adminUserId, source: "WEB_ADMIN" },
        { bannerId: banner.id, expectedVersion: 1, startsAt: new Date("2026-12-31"), endsAt: new Date("2026-01-01") },
      ),
    ).rejects.toThrow();
  });
});

describe("Banner OCC — устаревшая expectedVersion отклоняется (security review fix)", () => {
  it("параллельное изменение отклоняет stale-версию, не перезаписывает молча", async () => {
    const banner = await createBanner(
      { userId: adminUserId, source: "WEB_ADMIN" },
      { name: "OCC Test Banner", placement: `${placement}_occ`, desktopMediaId: mediaId },
    );
    bannerIds.push(banner.id);

    // Кто-то другой уже опубликовал баннер (version 1 -> 2).
    await publishBanner({ userId: adminUserId, source: "WEB_ADMIN" }, { bannerId: banner.id, expectedVersion: 1 });

    // Повторная попытка с устаревшей version=1 отклоняется, а не тихо проходит.
    await expect(
      archiveBanner({ userId: adminUserId, source: "WEB_ADMIN" }, { bannerId: banner.id, expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });

    const current = await prisma.banner.findUniqueOrThrow({ where: { id: banner.id } });
    expect(current.status).toBe("published"); // archive не применился
    expect(current.version).toBe(2);
  });
});
