-- Карточка товара: предупреждения, срок годности, производитель. Аддитивно: три nullable-колонки,
-- существующие строки не меняются, NULL = «не указано» (витрина и бот такие блоки не показывают).
-- ТОЛЬКО ФАЙЛ В РЕПОЗИТОРИИ: на боевую БД применяется владельцем отдельным шагом.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "manufacturer" TEXT,
ADD COLUMN     "shelfLife" TEXT,
ADD COLUMN     "warnings" TEXT;
