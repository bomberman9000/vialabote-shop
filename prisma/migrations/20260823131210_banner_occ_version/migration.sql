-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Banner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "placement" TEXT NOT NULL,
    "desktopMediaId" TEXT NOT NULL,
    "mobileMediaId" TEXT,
    "headline" TEXT,
    "subheadline" TEXT,
    "ctaLabel" TEXT,
    "ctaUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Banner_desktopMediaId_fkey" FOREIGN KEY ("desktopMediaId") REFERENCES "MediaAsset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Banner_mobileMediaId_fkey" FOREIGN KEY ("mobileMediaId") REFERENCES "MediaAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Banner" ("createdAt", "createdBy", "ctaLabel", "ctaUrl", "desktopMediaId", "endsAt", "headline", "id", "mobileMediaId", "name", "placement", "priority", "startsAt", "status", "subheadline", "updatedAt") SELECT "createdAt", "createdBy", "ctaLabel", "ctaUrl", "desktopMediaId", "endsAt", "headline", "id", "mobileMediaId", "name", "placement", "priority", "startsAt", "status", "subheadline", "updatedAt" FROM "Banner";
DROP TABLE "Banner";
ALTER TABLE "new_Banner" RENAME TO "Banner";
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT NOT NULL,
    "activeIngredients" TEXT,
    "howToUse" TEXT,
    "volume" TEXT,
    "badge" TEXT,
    "routineStep" INTEGER,
    "routineRole" TEXT,
    "price" INTEGER NOT NULL,
    "oldPrice" INTEGER,
    "imageUrl" TEXT NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER,
    "categoryId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("activeIngredients", "badge", "categoryId", "createdAt", "description", "displayOrder", "featured", "howToUse", "id", "imageUrl", "isActive", "oldPrice", "price", "routineRole", "routineStep", "slug", "status", "stock", "subtitle", "title", "updatedAt", "version", "volume") SELECT "activeIngredients", "badge", "categoryId", "createdAt", "description", "displayOrder", "featured", "howToUse", "id", "imageUrl", "isActive", "oldPrice", "price", "routineRole", "routineStep", "slug", "status", "stock", "subtitle", "title", "updatedAt", "version", "volume" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

