-- Одноразовый state ссылки авторизации Ozon (только добавление таблицы; старый код её не трогает).
-- CreateTable
CREATE TABLE "OzonOAuthState" (
    "nonce" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OzonOAuthState_pkey" PRIMARY KEY ("nonce")
);
