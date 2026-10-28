-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryMaxDate" TIMESTAMP(3),
ADD COLUMN     "deliveryMethod" TEXT,
ADD COLUMN     "deliveryPrice" INTEGER;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "ozonOfferId" TEXT,
ADD COLUMN     "ozonSku" TEXT;

-- CreateTable
CREATE TABLE "OzonOrder" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "deliveryType" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "quote" JSONB NOT NULL,
    "ozonOrderNumber" TEXT,
    "postingNumbers" TEXT[],
    "postings" JSONB,
    "status" TEXT,
    "cancelState" TEXT,
    "returns" JSONB,
    "refundState" TEXT,
    "lastError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OzonOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OzonOAuthToken" (
    "id" TEXT NOT NULL,
    "accessToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "refreshToken" TEXT NOT NULL,
    "scope" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OzonOAuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OzonOrder_orderId_key" ON "OzonOrder"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "OzonOrder_ozonOrderNumber_key" ON "OzonOrder"("ozonOrderNumber");

-- CreateIndex
CREATE INDEX "OzonOrder_state_idx" ON "OzonOrder"("state");

-- AddForeignKey
ALTER TABLE "OzonOrder" ADD CONSTRAINT "OzonOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

