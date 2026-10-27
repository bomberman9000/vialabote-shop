-- Журнал движений склада (сайт + Telegram-панель): ручные правки, резерв заказом,
-- возврат резерва, списание при оплате. См. src/lib/stock/movements.ts.
-- ТОЛЬКО ФАЙЛ В РЕПОЗИТОРИИ: на боевую БД применяется владельцем отдельным шагом
-- (см. ops/dr/RELEASE-telegram-cms-v2.md). Аддитивная миграция: существующие таблицы не меняются.

-- CreateTable
CREATE TABLE "StockChangeLog" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "oldStock" INTEGER NOT NULL,
    "newStock" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'ADJUST',
    "orderId" TEXT,
    "source" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorTelegramUserId" TEXT,
    "confirmationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockChangeLog_productId_createdAt_idx" ON "StockChangeLog"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "StockChangeLog_createdAt_idx" ON "StockChangeLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockChangeLog_orderId_productId_reason_key" ON "StockChangeLog"("orderId", "productId", "reason");
