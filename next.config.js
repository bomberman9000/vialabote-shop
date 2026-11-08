/** @type {import('next').NextConfig} */
const nextConfig = {
  // Все <Image src> в приложении — локальные пути (/uploads/media/... от
  // LocalMediaStorage, /images/... статические ассеты). Внешние хосты и SVG
  // через next/image не используются нигде — remotePatterns/dangerouslyAllowSVG
  // были избыточно разрешающими (wildcard "**" превращал image optimizer в
  // открытый прокси для произвольных внешних URL, если бы такой путь когда-
  // нибудь появился). Убраны, а не оставлены "на будущее".

  // Security-заголовки (audit-2026-11-07: к.40 — не было ни одного).
  // Правило одно и на все маршруты: source "/:path*".
  headers() {
    // В development режим Next/webpack собирает модули через eval() и грузит
    // HMR по websocket — без 'unsafe-eval' dev-сервер не запускается нормально,
    // а HSTS на http://localhost заставит браузер апгрейдить localhost до https.
    // Поэтому в dev эти две послабления, а в production (и в любой сборке) —
    // строгие значения, которые и проверяет тест src/lib/security-headers.test.ts.
    const isDev = process.env.NODE_ENV === "development";

    // Внешние источники найдены по коду (без догадок):
    //  * https://mc.yandex.ru      — Яндекс.Метрика: скрипт догружается
    //    динамически в src/components/cookie-banner.tsx (только после согласия
    //    пользователя), туда же уходят beacon'ы счётчика => script-src, connect-src.
    //  * https://fonts.googleapis.com — @import шрифта Manrope в src/app/globals.css
    //    (сам CSS) => style-src.
    //  * https://fonts.gstatic.com   — файлы шрифтов из того CSS => font-src.
    //  * плитки карты пунктов Ozon (Leaflet, src/app/checkout/ozon-map.tsx) —
    //    свой сервер плиток MAP_TILE_URL: по документации это либо путь
    //    /maps/... на нашем же домене (= 'self'), либо https-адрес отдельного
    //    сервера плиток. Точный origin в репозитории не зафиксирован, поэтому
    //    в img-src оставлен https: — сузить до конкретного origin, когда
    //    значение MAP_TILE_URL в проде будет известно.
    // Остальные внешние сервисы (Ozon Seller API, Ozon OAuth, Tochka, Telegram
    // Bot API, геокодер) работают ТОЛЬКО на сервере (route handlers) или через
    // top-level redirect — браузер не грузит с них ресурсы, поэтому в CSP их
    // нет. iframe/embed виджетов Ozon в приложении нет: frame-src 'self'.
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://mc.yandex.ru`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://mc.yandex.ru",
      "frame-src 'self'",
      "media-src 'self'",
      "worker-src 'self' blob:",
    ].join("; ");

    const headers = [
      { key: "Content-Security-Policy", value: csp },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=()" },
    ];

    // HSTS — только в production: в dev это ломает работу по http://localhost.
    if (!isDev) headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });

    return [{ source: "/:path*", headers }];
  },
};

module.exports = nextConfig;
