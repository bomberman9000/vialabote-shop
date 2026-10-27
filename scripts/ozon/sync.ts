// Опрос Ozon Доставки (вебхуки Ozon не регистрируются): доводит оплаченные заказы, которые не удалось
// отправить сразу, помечает зависшие, обновляет статусы, отмены и возвраты. Запускать таймером, напр. раз в 10 мин:
//   cd /opt/vialabote-shop/current && npx tsx scripts/ozon/sync.ts
// Код выхода 1 — были ошибки (подробности в lastError заказов, без данных покупателя).
import { prisma } from "@/lib/prisma";
import { syncOzonOrders } from "@/lib/delivery/ozon-orders";

syncOzonOrders()
  .then((r) => {
    console.log(JSON.stringify(r));
    if (r.errors.length) process.exitCode = 1;
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
