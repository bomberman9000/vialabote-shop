# Vialabote — интернет-магазин

Собственный интернет-магазин косметики и ухода Vialabote: каталог, корзина,
оформление заказа с онлайн-оплатой (ЮKassa), личный кабинет с историей
заказов и простая админ-панель для управления товарами и заказами.

Стек: Next.js 14 (App Router) + TypeScript + Tailwind CSS + Prisma +
NextAuth.

## Быстрый старт

```bash
npm install
cp .env.example .env
# сгенерируйте NEXTAUTH_SECRET и впишите его в .env:
openssl rand -base64 32

npm run db:push   # создаёт таблицы (SQLite-файл dev.db)
npm run db:seed   # добавляет тестовые товары и админ-аккаунт
npm run dev
```

Сайт будет доступен на http://localhost:3000.

После сидирования данные для входа в админ-панель:
- Email: `admin@vialabote.ru` (или значение `SEED_ADMIN_EMAIL` из `.env`)
- Пароль: `admin12345` (или значение `SEED_ADMIN_PASSWORD`)

Админ-панель: `/admin/products` (управление товарами) и `/admin/orders`
(список заказов).

## Загрузка реальных фото товаров

Плейсхолдер-картинки лежат в `public/images/placeholder.svg`. Чтобы
подключить настоящие фото:

1. Перейдите в репозиторий на github.com → папка `public/images/products/`.
2. Кнопка **Add file → Upload files**, перетащите файлы фото (jpg/png/webp).
3. Закоммитьте прямо в ветку `main` (или в свою рабочую ветку).
4. В админ-панели (`/admin/products`) при добавлении/редактировании товара
   укажите путь к файлу в поле «URL картинки», например:
   `/images/products/serum-white-tea.jpg`.

## Онлайн-оплата (ЮKassa)

1. Зарегистрируйте магазин на https://yookassa.ru (можно начать с тестового
   магазина в личном кабинете — он выдаёт `shopId` и `secretKey` для
   тестовых платежей без реальных списаний).
2. Впишите значения в `.env`:
   ```
   YOOKASSA_SHOP_ID="ваш shopId"
   YOOKASSA_SECRET_KEY="ваш secretKey"
   ```
3. В личном кабинете ЮKassa укажите URL для вебхуков (уведомлений об
   оплате): `https://ваш-домен/api/payment/webhook`.
4. Если переменные не заданы — сайт всё равно принимает заказы, но без
   онлайн-оплаты (статус «оплата при получении»), это удобно для разработки.

## Продакшен: база данных

Локально используется SQLite. Для продакшена рекомендуется Postgres:

1. В `prisma/schema.prisma` смените `provider = "sqlite"` на
   `provider = "postgresql"`.
2. Задайте `DATABASE_URL` в переменных окружения хостинга, например:
   `postgresql://user:password@host:5432/vialabote`.
3. Выполните `npx prisma db push` (или настройте миграции через
   `npx prisma migrate deploy`).

## Деплой

Проект — обычное Next.js-приложение, разворачивается на Vercel, Railway,
Render или любом хостинге с поддержкой Node.js. Для Vercel: подключите
репозиторий, задайте переменные окружения из `.env.example` в настройках
проекта, база данных — управляемый Postgres (Vercel Postgres / Neon /
Railway).

## Структура проекта

```
prisma/schema.prisma      модели: User, Product, Category, Order, OrderItem
src/lib/                  prisma-клиент, auth (NextAuth), корзина, ЮKassa
src/app/                  страницы (App Router)
  catalog/, product/[slug]/   каталог и карточка товара
  cart/, checkout/             корзина и оформление заказа
  account/                     вход, регистрация, личный кабинет
  admin/                       админ-панель (товары, заказы)
  api/                          серверные роуты (заказы, оплата, auth)
```
