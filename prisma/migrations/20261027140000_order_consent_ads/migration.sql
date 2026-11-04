-- Отдельное необязательное рекламное согласие и источник согласий.
-- Nullable-колонки без default: метаданные, старые заказы не затрагиваются.
ALTER TABLE "Order" ADD COLUMN "adsConsentAt" TEXT;
ALTER TABLE "Order" ADD COLUMN "consentSource" TEXT;
