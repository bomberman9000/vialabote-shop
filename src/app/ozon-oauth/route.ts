import { prisma } from "@/lib/prisma";
import { OzonError, ozonConfig } from "@/lib/delivery/ozon";
import { consumeState } from "@/lib/delivery/ozon-oauth";
import { createTokenStore } from "@/lib/delivery/ozon-token";
import { allowRequest } from "@/lib/delivery/ozon-service";

export const dynamic = "force-dynamic";

// redirect_uri частного приложения Ozon: сюда Ozon возвращает владельца с ?code=…&state=… после согласия.
// code меняется на токены (в БД, OzonOAuthToken "seller") только по одноразовому state из scripts/ozon/oauth.ts url
// (src/lib/delivery/ozon-oauth.ts): state гасится до обмена, повтор того же адреса ничего не меняет.
// Токены, code и client_secret на страницу и в журнал не попадают. Всегда боевое приложение: песочнице
// авторизация не нужна (client_credentials), поэтому OZON_ENV здесь не учитывается.

function page(status: number, title: string, text: string): Response {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const html =
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${esc(title)}</title></head>` +
    `<body style="font-family:system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 16px;line-height:1.5">` +
    `<h1 style="font-size:22px">${esc(title)}</h1><p>${esc(text)}</p></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // В адресе этой страницы code: не отдавать его чужим сайтам через Referer.
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}

export async function GET(req: Request) {
  if (!allowRequest(req, "ozon-oauth", 10)) return page(429, "Слишком много попыток", "Попробуйте через минуту.");
  const cfg = ozonConfig({ ...process.env, OZON_ENV: "prod" });
  if (!cfg?.app.redirectUri) {
    return page(503, "Ozon не настроен", "На сервере нет OZON_APP_CLIENT_ID / OZON_APP_CLIENT_SECRET / OZON_APP_REDIRECT_URI.");
  }

  const q = new URL(req.url).searchParams;
  const code = q.get("code");
  const denied = q.get("error");
  // Гасим state до обмена: и при отказе, и при сбое ссылка одноразовая — нужна новая.
  if (!(await consumeState(prisma, q.get("state"), cfg.app.clientSecret))) {
    return page(
      400,
      "Ссылка недействительна",
      "Ссылка устарела, уже использована или выдана не этим магазином. Если до этого было «Ozon подключён» — всё готово; иначе создайте новую: scripts/ozon/oauth.ts url.",
    );
  }
  if (denied) {
    const reason = /^[a-z_]{1,40}$/.test(denied) ? ` (${denied})` : "";
    return page(400, "Доступ не выдан", `Ozon вернул отказ${reason}. Создайте новую ссылку и подтвердите доступ.`);
  }
  if (!code || code.length > 2048) return page(400, "Нет кода авторизации", "Ozon не передал code. Создайте новую ссылку.");

  try {
    const r = await createTokenStore(cfg, { prisma }).exchangeCode(code);
    console.log("ozon-oauth: токен получен и сохранён");
    return page(
      200,
      "Ozon подключён",
      `Токен сохранён на сервере (действует ${Math.round(r.expiresIn / 60)} мин, дальше обновляется сам). Доступы: ${r.scope ?? "—"}. Страницу можно закрыть.`,
    );
  } catch (err) {
    const msg = err instanceof OzonError ? err.message : err instanceof Error ? err.message : "неизвестная ошибка";
    console.error("ozon-oauth: обмен кода не удался", msg);
    return page(502, "Не удалось подключить Ozon", `${msg}. Создайте новую ссылку и повторите.`);
  }
}
