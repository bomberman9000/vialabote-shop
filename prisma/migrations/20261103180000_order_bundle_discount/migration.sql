-- Скидка за наборы (src/lib/bundles.ts): сумма и какие наборы сработали. Только добавление, старый код поле не читает.
ALTER TABLE "Order" ADD COLUMN "bundleDiscount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "bundles" TEXT;
