-- Получатель по умолчанию и последний пункт Ozon — форма заказа заполняется из профиля.
-- Nullable-колонки без default: только добавление, старый код их не читает.
ALTER TABLE "User" ADD COLUMN "lastName" TEXT;
ALTER TABLE "User" ADD COLUMN "firstName" TEXT;
ALTER TABLE "User" ADD COLUMN "middleName" TEXT;
ALTER TABLE "User" ADD COLUMN "ozonPointId" TEXT;
