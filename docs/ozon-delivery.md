# Ozon Доставка для shop.vialabote.ru

Доставка заказов с сайта через «Ozon Доставку для продавцов» (Seller API, раздел «Ozon Доставка»).
Оплата — онлайн через Точку; наложенного платежа у Ozon нет, поэтому без настроенной Точки доставка Ozon в checkout не предлагается.

## Поток заказа

1. **Checkout.** Покупатель находит ПВЗ одним из способов:
   - «рядом со мной» (геолокация браузера) или у центра города из списка → `GET /api/delivery/ozon/points?lat&long` → `GET /api/delivery/ozon/points/info?ids=…`;
   - город + улица (и дом) → `GET /api/delivery/ozon/points/search?lat&long&q=Свободы 2`: поиск по адресам пунктов в 40 км
     от центра города (до 1000 ближайших, карточки из Ozon кешируются на час), без геокодера;
   - карта (Leaflet + тайлы OpenStreetMap, открывается только кнопкой «Выбрать на карте») → отметки из
     `GET /api/delivery/ozon/points?minLat&minLong&maxLat&maxLong` (масштаб от 12), адрес — только для выбранной отметки.
   После выбора пункта `POST /api/delivery/ozon/quote` показывает цену и **максимальный срок**: «получение не позднее …».
2. **`POST /api/orders`** с `delivery: { provider: "OZON", destination: { type: "PVZ", mapPointId }, recipient: { lastName, firstName } }`.
   Сервер проверяет, что у номера из заказа есть аккаунт Ozon (`v1/delivery/check`; без него получить посылку нельзя).
   Публичного метода «проверить любой номер» нет: это был бы оракул аккаунтов Ozon на ключе магазина.
   Затем сервер сам считает доставку (`v2/delivery/checkout`), прибавляет её к `totalAmount` и сохраняет `deliveryPrice` и `deliveryMaxDate`.
   В той же транзакции, что заказ и резерв склада, создаётся `OzonOrder` в состоянии `PENDING`. **Заказа в Ozon на этом шаге нет.**
3. **Вебхук Точки** → банк подтвердил `APPROVED` → заказ `PAID` и `commitOrder`. После закрытия этой транзакции вызывается
   `settleOzonAfterPayment`: атомарный переход `PENDING → CREATING`, повторный `checkout` (свежие таймслоты) и `v2/order/create`.
   В БД сохраняются номер заказа Ozon и номера отправлений. Заказ сайта переходит в `PROCESSING`.
4. **Опрос** `scripts/ozon/sync.ts` (таймер): доводит `PENDING` у оплаченных заказов, помечает зависшие `CREATING` (>10 мин) как `UNKNOWN`.
   Через `v4/posting/fbs/list` и `v3/posting/fbs/get` обновляет статусы: `delivering` → `SHIPPED`, `delivered` → `COMPLETED`.
   Через `v1/returns/list` видны невыкупы и частичные отказы. Вебхуки Ozon не регистрируются. Заготовка `/api/delivery/ozon/webhook`
   берёт из тела только номер отправления, а статус запрашивает у Ozon.

## Состояния `OzonOrder.state` и ручной разбор

| state | значит | что делать |
|---|---|---|
| `PENDING` | ждёт оплаты или повтора (429, авторизация, сеть до отправки) | ничего: опрос повторит, после 5 попыток → `FAILED` |
| `CREATING` | идёт создание | ничего; дольше 10 мин → `UNKNOWN` |
| `CREATED` | заказ в Ozon есть | — |
| `FAILED` | Ozon отказал (4xx) или checkout недоступен — **доставка не создана**, оплата в силе | Web Admin → `POST /api/admin/orders/{id}/ozon {"action":"retry"}` или возврат денег |
| `UNKNOWN` | таймаут/5xx на `order/create` — заказ в Ozon **мог** создаться | сверить кабинет Ozon; если заказа нет — `{"action":"retry","confirmNotInOzon":true}` |
| `CANCELLING` / `CANCELLED` | отмена запрошена / подтверждена | после подтверждения `refundState = REQUIRED` |

`refundState = "REQUIRED"` → деньги покупателю возвращаются **вручную**: метод возврата Точки ещё не реализован (следующий шаг).

## Отмена

`POST /api/admin/orders/{id}/ozon {"action":"cancel","reasonId":508}` выполняет `v1/order/cancel/check`, затем `v1/cancel-reason/list-by-order`,
`v1/order/cancel` и `v1/order/cancel/status`. Если в справочнике нет переданной причины, берётся 508 («Не нашёл нужную причину») или первая из списка.
`Подтверждена` → `CANCELLED` + `refundState REQUIRED`. `На подтверждении` — опрос дождётся. Если заказ ещё не создан в Ozon (`PENDING`/`FAILED`),
отмена делается локально, без вызовов Ozon. Склад сайта при отмене не возвращается: оплаченные позиции уже списаны (`WRITE_OFF`),
поэтому возврат товара на склад — ручная правка.

## Подключение (делает владелец)

1. **Частное приложение** (методы доставки принимают только OAuth): ЛК продавца → Настройки → Управление частными приложениями → Создать.
   Указать уровни доступа (см. «Роли») → выдать доступ разработчику → в настройках приложения: IP сервера, обратный URL, ссылка авторизации.
2. На сервере в `/etc/vialabote-shop/app.env`: `OZON_APP_CLIENT_ID`, `OZON_APP_CLIENT_SECRET`, `OZON_APP_CLIENT_SECRET_SANDBOX`,
   `OZON_APP_REDIRECT_URI=https://shop.vialabote.ru/ozon-oauth`, `OZON_APP_SCOPE` (идентификаторы уровней доступа через пробел)
   (+ при желании `OZON_CLIENT_ID`, `OZON_API_KEY` для остатков и отправлений). `OZON_CHECKOUT_ENABLED` пока **не** ставить:
   без него покупатели Ozon не видят, а ключи проверяются скриптами.
3. Миграции `prisma/migrations/20261027200000_ozon_delivery` и `20261027220000_ozon_oauth_state` (`npx prisma migrate deploy`) — **до** выкладки кода.
4. Авторизация: `npx tsx scripts/ozon/oauth.ts url` → открыть ссылку (одноразовая, 15 мин) в браузере, где вход в кабинет Ozon →
   согласиться. Ozon вернёт на `/ozon-oauth`: страница погасит одноразовый `state` (таблица `OzonOAuthState`), обменяет `code` и напишет «Ozon подключён».
   Запасной путь — `oauth.ts exchange <code>`. Токены — в таблице `OzonOAuthToken`, на страницу и в консоль не выводятся.
5. Товары: в `Product.ozonSku` (SKU Ozon) и `Product.ozonOfferId` (артикул) — карточки на Ozon с остатком на FBS-складе.
   Товар без `ozonSku` в доставку Ozon не попадает: расчёт вернёт `NOT_MAPPED`.
6. Проверка (только чтение): `scripts/ozon/check.ts`, см. ниже. Сценарий заказа — в песочнице, `scripts/ozon/sandbox-e2e.ts`.
   Витрина включается `OZON_CHECKOUT_ENABLED=1` + рестарт, когда оба прогона чистые.
7. Таймер опроса: `scripts/ozon/sync.ts` раз в 10 минут (systemd timer с тем же `EnvironmentFile`).
8. Адрес клиента для ограничителя частоты берётся из `X-Forwarded-For`, справа налево с учётом `TRUSTED_PROXY_HOPS`
   (сколько наших прокси дописывают XFF). `X-Real-IP` не читается: `ops/dr/edge-setup.sh` и `vm-*.sh` его не ставят,
   и клиентский заголовок доходит до приложения как есть. Сейчас `vm-dr-layer.sh` перезаписывает
   `X-Forwarded-For $remote_addr` (адрес edge), и все покупатели выглядят одним адресом. В этом случае лимиты с адреса
   становятся общими на сайт: 10 оформлений с Ozon, 30 расчётов и 60 запросов ПВЗ в минуту.
   Чтобы лимиты считались по покупателю: в VM-nginx `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`
   и `TRUSTED_PROXY_HOPS=2` (edge + VM). Это правка инфраструктуры — решение владельца.

### Остаточный риск: «есть ли у номера аккаунт Ozon»
Ответ при оформлении (`NO_OZON_ACCOUNT`) неизбежно говорит покупателю, что с этим номером получить заказ нельзя:
иначе он заплатит за то, что не сможет получить. Перебор номеров ограничен: 10 попыток в минуту с адреса,
5 проверок в час на номер и общий потолок. Полностью закрыть его можно только подтверждением номера (код по SMS)
до проверки — это отдельная задача.

## Проверка на сервере (только чтение)

Скрипты запускаются через `systemd-run` с тем же `EnvironmentFile`, что у сервиса: `set -a; . app.env` в bash теряет
`DATABASE_URL` (в адресе есть `&`), а `node` нет в `PATH` root.

Запускать **на сервере сайта** (там есть `/etc/vialabote-shop/app.env`), после выкладки этой ветки: в текущем релизе
скрипта нет. На рабочей машине (ZEROHOUR) ни окружения, ни релиза нет. Вместо `123456789` и `VL-001` подставьте
SKU и артикул товара из кабинета Ozon. Угловые скобки не писать: bash примет их за перенаправление.

```bash
sudo systemd-run --quiet --wait --pipe --collect -p EnvironmentFile=/etc/vialabote-shop/app.env -p Environment=NODE_EXTRA_CA_CERTS=/etc/vialabote-shop/russian_trusted_root_ca.pem -p WorkingDirectory=/opt/vialabote-shop/current -E PATH=/opt/vialabote-shop/node-v24.21.0/bin:/usr/bin:/bin /opt/vialabote-shop/current/node_modules/.bin/tsx scripts/ozon/check.ts --sku 123456789 --offer VL-001
```

Скрипт печатает: какие переменные заданы (без значений), роли Api-Key и срок его действия (`/v1/roles`) и методы, которые есть в OAuth-токене.
Дальше — количество ПВЗ (`/v1/delivery/point/list`), остаток FBS, а для **Самара→Москва, Самара→Новосибирск, Самара→Самара** —
ближайший ПВЗ к центру города и `v2/delivery/checkout` до него и курьером: цена, крайний срок, метод, склад.
Любой путь вне белого списка (в том числе `v2/order/create` и отмена) блокируется до сети.
Ошибки печатаются с HTTP-кодом и текстом ответа Ozon: по нему видно, например, `Api-Key is restricted to specific IP addresses`.

## Песочница (сценарий заказа без реального заказа)

`api-seller-sandbox.ozon.ru`, токен — `client_credentials` с секретом песочницы (`OZON_APP_CLIENT_SECRET_SANDBOX`), строка
`OzonOAuthToken` `sandbox` отдельно от боевой `seller`. Песочница поддерживает ПВЗ, `v2/delivery/checkout`, `v2/order/create`,
отмену, `v4/posting/fbs/list` и остатки; `v3/posting/fbs/get`, `v1/returns/list` и `v1/roles` в ней нет.

```bash
sudo systemd-run --quiet --wait --pipe --collect -p EnvironmentFile=/etc/vialabote-shop/app.env -p Environment=NODE_EXTRA_CA_CERTS=/etc/vialabote-shop/russian_trusted_root_ca.pem -p WorkingDirectory=/opt/vialabote-shop/current -E PATH=/opt/vialabote-shop/node-v24.21.0/bin:/usr/bin:/bin /opt/vialabote-shop/current/node_modules/.bin/tsx scripts/ozon/sandbox-e2e.ts --advance 1
```

Скрипт берёт товар песочницы (`v3/product/list` → остатки), ближайший к центру Москвы ПВЗ и тестового покупателя
`+79990000001`, считает доставку, создаёт заказ тем же `buildOrderCreateBody`, что и боевой, показывает отправления,
сдвигает статус (`/v1/sandbox/posting/status/change`) и отменяет заказ. `--dry` — без `order/create`, `--keep` — без отмены.
Любой запрос не на хост песочницы блокируется до сети.

`OZON_ENV=sandbox` в `app.env` выключает всё боевое: витрина без Ozon, оплаченные заказы в Ozon не уходят (останутся `PENDING`).
Скриптам песочницы `OZON_ENV` не нужен — они всегда работают с песочницей.

## Роли

В спецификации у методов роли не указаны. Достоверный способ — `/v1/roles`: скрипт показывает, какая роль ключа даёт каждый нужный метод.
Сайту нужно:

- **OAuth-приложение (обязательно):** точки самовывоза, карта, проверка, checkout, создание заказа, отмена
  (`v1/delivery/*`, `v2/delivery/checkout`, `v2/order/create`, `v1/order/cancel*`, `v1/cancel-reason/list-by-order`, `v1/posting/cancel*`).
- **Api-Key (необязательно):** `v4/product/info/stocks` (остатки), `v4/posting/fbs/list` и `v3/posting/fbs/get` (отправления),
  `v1/returns/list` (возвраты). Роль Admin для этого избыточна: достаточно ролей на чтение товаров/остатков, отправлений FBS и возвратов.
  Точные названия ролей покажет `/v1/roles`; после этого ключ можно перевыпустить с минимальным набором. Срок жизни ключа — 3 месяца.

## Ограничения этой версии

- Карта — OpenStreetMap (выбор владельца, 2026-10-28): при открытии карты браузер покупателя грузит тайлы с серверов OSM
  за рубежом (IP покупателя уходит туда) — вопрос к политике ПДн / уведомлению о трансграничной передаче. До нажатия
  «Выбрать на карте» к OSM не обращаемся. Кластеры Ozon (`POST /api/delivery/ozon/map`) в checkout не используются.
- Поиск по улице сравнивает текст адреса пункта, а не расстояние до дома покупателя: пункт за углом на соседней улице
  найдётся только на карте.
- Курьер реализован в API (`destination: { type: "COURIER", latitude, longitude }` + адрес), но в checkout не выведен: нужны координаты адреса (тот же геокодер).
- Только схема FBS опрашивается по отправлениям (`v4/posting/fbs/list`); для FBO нужен `v2/posting/fbo/list`.
- `price.nanos` в `v2/order/create` передаётся как в google.type.Money (копейки × 10⁷). В документации Ozon nanos описан как «копейки» —
  не подтверждено. При ценах в целых рублях nanos = 0, и разночтения нет.
- Чеки 54-ФЗ и вывод КИЗ «Честного знака» из оборота (`v1/posting/marks`) — на стороне сайта, не реализованы.
- Возврат денег (refund Точки) не реализован: `refundState = REQUIRED` — сигнал для ручного возврата.
