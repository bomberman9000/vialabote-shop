# Склад: контракт для сайта и оплаты (`src/lib/stock/movements.ts`)

Ветка `claude/telegram-admin-bot`. Один остаток (`Product.stock`) и один журнал (`StockChangeLog`) на сайт, оплату, бот и Web Admin. Все функции принимают **транзакцию вызывающего** и пишут журнал в ней же; сами транзакцию не открывают.

## Сигнатуры

```ts
import type { Prisma } from "@prisma/client";
type Tx = Prisma.TransactionClient;
type StockSource = "TELEGRAM" | "WEB_ADMIN" | "SITE_ORDER" | "PAYMENT_WEBHOOK";

reserveForOrder(tx: Tx, args: { orderId: string; items: { productId: string; quantity: number }[]; source?: StockSource /* "SITE_ORDER" */ })
  : Promise<{ alreadyReserved: boolean; lines: { productId: string; quantity: number; stockAfter: number }[] }>
// бросает StockError: "OUT_OF_STOCK" (details: { productId, title, requested, available }), "NOT_FOUND", "INVALID"

releaseOrder(tx: Tx, args: { orderId: string; source?: StockSource /* "PAYMENT_WEBHOOK" */ })
  : Promise<{ released: { productId; quantity; stockAfter }[]; alreadyReleased: string[]; committed: string[] }>

commitOrder(tx: Tx, args: { orderId: string; source?: StockSource /* "PAYMENT_WEBHOOK" */ })
  : Promise<{ committed: string[]; alreadyCommitted: string[]; releasedBeforePayment: string[] }>

adjustStock(tx: Tx, args: { productId: string; expectedVersion: number; newStock: number; source: StockSource;
  actorUserId?: string; actorTelegramUserId?: string; confirmationId?: string }) : Promise<{ before; after }>

class StockError extends Error { code: "OUT_OF_STOCK" | "NOT_FOUND" | "VERSION_CONFLICT" | "INVALID"; details: Record<string, unknown> }
lockOrder(tx: Tx, orderId: string): Promise<void>   // вызывается внутри трёх функций заказа; снаружи не нужен
isDuplicateMovement(err: unknown): boolean   // P2002 на (orderId, productId, reason): движение уже сделано параллельно
```

## Поведение

| Функция | Остаток | Журнал | Повтор |
|---|---|---|---|
| `reserveForOrder` | `stock -= qty` только при `stock >= qty` (условный UPDATE, атомарно); `version++` | `RESERVE`, delta −qty | по тому же `orderId` ничего не меняет, `alreadyReserved: true` |
| `releaseOrder` | `stock += qty` по каждому резерву; `version++` | `RELEASE`, delta +qty | второй раз ничего не возвращает (`alreadyReleased`); оплаченные позиции не трогает (`committed`) |
| `commitOrder` | не меняется (уже уменьшен резервом) | `WRITE_OFF`, delta 0 | `alreadyCommitted`; если резерв уже возвращён — `releasedBeforePayment`, склад не трогает |
| `adjustStock` | выставить `newStock` при совпадении `version` | `ADJUST`, `orderId = null` | — (защита — OCC) |

- **Нехватка.** `OUT_OF_STOCK` нельзя ловить внутри `$transaction`: пусть она выйдет наружу. Тогда откатится всё — заказ и уже сделанные резервы других позиций.
- **Блокировка заказа.** Каждая из трёх функций заказа первым делом делает `SELECT "id" FROM "Order" WHERE "id" = $1 FOR UPDATE` (`lockOrder`). Движения одного заказа идут строго по очереди: отмена, пришедшая во время оплаты, ждёт и видит уже записанный `WRITE_OFF`. Заказа с таким `orderId` нет — `StockError("NOT_FOUND")`, поэтому заказ создаётся в той же транзакции **до** `reserveForOrder` (как в примере ниже). Проверено на PostgreSQL 18 (`src/lib/stock/movements.pg.test.ts`): без блокировки 3 теста гонок падают.
- **Удалённый товар** при `releaseOrder`: строка `RELEASE` с `0 → 0` (delta 0) и пометкой в `productTitle`, остаток вернуть некуда.
- **Позиции заказа** склеиваются по `productId` и сортируются: все заказы блокируют строки в одном порядке.
- **`version++` при резерве и возврате** — намеренно. Предпросмотр правки остатка в боте, сделанный до заказа, после резерва не перезапишет остаток: ответ будет «Товар изменился».
- **Заказы, созданные до этой логики** (без `RESERVE`): `releaseOrder` и `commitOrder` вернут пустой результат, без ошибки.
- **Гонка двух одинаковых вебхуков.** Вторая транзакция упадёт на unique `(orderId, productId, reason)` с P2002 и откатится. Вызывающий проверяет `isDuplicateMovement(err)` и отвечает провайдеру 200.

## Пример вызова (для `src/app/api/orders/route.ts` и `src/app/api/payment/webhook/route.ts`, сессия vialabote-legal)

```ts
import { prisma } from "@/lib/prisma";
import { reserveForOrder, releaseOrder, commitOrder, StockError, isDuplicateMovement } from "@/lib/stock/movements";

// создание заказа: заказ + резерв одной транзакцией
try {
  const order = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({ data: { /* как сейчас */ items: { create: lines } } });
    await reserveForOrder(tx, { orderId: order.id, items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })) });
    return order;
  });
  // ... создание платежа как сейчас
} catch (err) {
  if (err instanceof StockError && err.code === "OUT_OF_STOCK") {
    return NextResponse.json({ error: err.message, productId: err.details.productId, available: err.details.available }, { status: 409 });
  }
  throw err;
}

// вебхук оплаты
try {
  await prisma.$transaction(async (tx) => {
    if (event === "payment.succeeded") {
      await tx.order.update({ where: { id: orderId }, data: { status: "PAID" } });
      await commitOrder(tx, { orderId });
    } else if (event === "payment.canceled") {
      await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
      await releaseOrder(tx, { orderId });
    }
  });
} catch (err) {
  if (!isDuplicateMovement(err)) throw err; // повтор вебхука — уже обработан
}
```

Если ЮKassa не подтвердила платёж (создание платежа упало после резерва), заказ нужно отменить с `releaseOrder`, иначе товар останется в резерве. Сейчас такого вызова нет: его добавляет vialabote-legal.

## Проверено (на in-memory Prisma, без PostgreSQL)

`src/lib/stock/movements.test.ts` (23) и `src/lib/stock/bot-stock.e2e.test.ts` (6): резерв, нехватка с полным откатом, повтор резерва, release и commit, гонка за последнюю единицу (без транзакций и внутри них), повторный release в гонке, конфликт версии бота после резерва. E2E: бот 2→5 → заказ A резервирует 3 → заказ B на 3 отклонён → отмена A → повтор вебхука → заказ C на 4 оплачен → поздняя отмена C ничего не вернула. Журнал: `ADJUST +3`, `RESERVE −3`, `RELEASE +3`, `RESERVE −4`, `WRITE_OFF 0`; итог 1 = 2 + Σdelta. Мутационная проверка: если заменить условный UPDATE на «прочитал → записал», тест гонки падает.

Миграция `prisma/migrations/20261027000000_stock_change_log/migration.sql` совпадает с DDL, который генерирует `prisma migrate diff --from-empty --to-schema-datamodel` для `StockChangeLog`. **Не применена** ни к одной БД.
