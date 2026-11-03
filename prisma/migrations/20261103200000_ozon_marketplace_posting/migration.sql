-- Отправления FBS с маркетплейса Ozon (не заказы сайта), уже учтённые в остатке сайта: каждое списывается
-- один раз, отмена возвращает товар один раз. Только новая таблица.
CREATE TABLE "OzonMarketplacePosting" (
    "postingNumber" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OzonMarketplacePosting_pkey" PRIMARY KEY ("postingNumber")
);
