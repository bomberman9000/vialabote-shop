import { NextResponse, type NextRequest } from "next/server";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  evaluateCsrf,
  generateCsrfToken,
  hasSessionCookie,
} from "@/lib/csrf";

// CSRF-защита cookie-аутентификации (audit-2026-11-07: к.33).
//
// Правило: изменяющий состояние запрос, который несёт СЕССИОННУЮ cookie, обязан прислать
// CSRF-токен (double-submit) и иметь наш Origin. Всё остальное не трогаем: гостевой checkout,
// вебхуки Ozon/Точки и служебные вызовы сессии не несут и не должны нести.
//
// Токен выдаётся cookie vialabote-csrf (её значение читает JS) — она кладётся в ответ,
// когда токена ещё нет, чтобы браузер успел получить его до первого изменяющего запроса.
export const config = {
  // Статика и файлы с расширением — без middleware.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|.*\\..*).*)",
  ],
};

/** Доверенные Origin сверх нашего хоста: NEXT_PUBLIC_APP_URL (https://shop.vialabote.ru). */
function allowedOrigins(): string[] {
  const list = process.env.NEXT_PUBLIC_APP_URL;
  return list ? [list] : [];
}

/** Выдать CSRF-куку, если её ещё нет (значение клиент должен прочитать сам). */
function ensureCsrfCookie(req: NextRequest, res: NextResponse): void {
  if (req.cookies.get(CSRF_COOKIE_NAME)) return;
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  res.cookies.set({
    name: CSRF_COOKIE_NAME,
    value: generateCsrfToken(),
    httpOnly: false,
    sameSite: "strict",
    secure: proto === "https",
    path: "/",
  });
}

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? req.nextUrl.host;
  const result = evaluateCsrf({
    method: req.method,
    path: req.nextUrl.pathname,
    host,
    origin: req.headers.get("origin"),
    referer: req.headers.get("referer"),
    token: req.headers.get(CSRF_HEADER_NAME),
    cookieToken: req.cookies.get(CSRF_COOKIE_NAME)?.value ?? null,
    hasSession: hasSessionCookie(req.cookies),
    allowedOrigins: allowedOrigins(),
  });

  if (!result.ok) {
    const denied = NextResponse.json(
      { error: "Запрос отклонён: не пройдена проверка CSRF. Обновите страницу и повторите." },
      { status: 403 },
    );
    // Куку с токеном всё равно выдаём: клиент сможет повторить запрос корректно.
    ensureCsrfCookie(req, denied);
    return denied;
  }

  const res = NextResponse.next();
  ensureCsrfCookie(req, res);
  return res;
}
