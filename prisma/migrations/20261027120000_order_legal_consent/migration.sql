-- Факт согласия с офертой и на обработку ПДн (ст. 9 152-ФЗ) и версия документов.
-- Nullable-колонки без default: в Postgres это изменение только метаданных,
-- старые заказы и предыдущий релиз продолжают работать.
ALTER TABLE "Order" ADD COLUMN "offerAcceptedAt" TEXT;
ALTER TABLE "Order" ADD COLUMN "pdnConsentAt" TEXT;
ALTER TABLE "Order" ADD COLUMN "legalVersion" TEXT;
