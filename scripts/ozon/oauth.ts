// Первичная авторизация частного приложения Ozon (методы доставки принимают только OAuth-токен).
// Токены пишутся в БД (OzonOAuthToken) и в консоль не выводятся.
//
//   npx tsx scripts/ozon/oauth.ts url [scope ...]   ссылка авторизации (открыть в браузере, где вход в кабинет Ozon);
//                                                   Ozon вернёт на OZON_APP_REDIRECT_URI (/ozon-oauth), сайт сам обменяет code
//   npx tsx scripts/ozon/oauth.ts exchange <code>   обменять code вручную (если /ozon-oauth недоступна)
//   npx tsx scripts/ozon/oauth.ts status            есть ли токен, до какого времени, scope (боевой и песочницы)
// Окружение — как у сервиса (/etc/vialabote-shop/app.env): OZON_APP_CLIENT_ID, OZON_APP_CLIENT_SECRET, OZON_APP_REDIRECT_URI,
// OZON_APP_SCOPE (идентификаторы через пробел). Ссылка и обмен — всегда боевое приложение, независимо от OZON_ENV.
import { prisma } from "@/lib/prisma";
import { ozonConfig } from "@/lib/delivery/ozon";
import { authorizeUrl, STATE_TTL_MS } from "@/lib/delivery/ozon-oauth";
import { createTokenStore } from "@/lib/delivery/ozon-token";

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === "status") {
    const rows = await prisma.ozonOAuthToken.findMany({ select: { id: true, expiresAt: true, scope: true, updatedAt: true } });
    if (!rows.length) console.log("токенов нет");
    for (const r of rows) {
      const name = r.id === "sandbox" ? "песочница" : r.id === "seller" ? "боевой" : r.id;
      console.log(`${name}: access до ${r.expiresAt?.toISOString() ?? "—"}; обновлён ${r.updatedAt.toISOString()}; scope: ${r.scope ?? "—"}`);
    }
    return;
  }

  const cfg = ozonConfig({ ...process.env, OZON_ENV: "prod" });
  if (!cfg) throw new Error("Нет OZON_APP_CLIENT_ID / OZON_APP_CLIENT_SECRET (боевой секрет приложения)");

  if (cmd === "url") {
    const scope = rest.length ? rest.join(" ") : (process.env.OZON_APP_SCOPE ?? "");
    console.log(authorizeUrl(cfg, scope));
    console.log(`\nСсылка действует ${STATE_TTL_MS / 60_000} мин. Откройте её в браузере, где выполнен вход в кабинет продавца Ozon,`);
    console.log(`и подтвердите доступ. Ozon вернёт на ${cfg.app.redirectUri} — страница сама сохранит токен и напишет «Ozon подключён».`);
    if (!scope) console.log("Внимание: scope пуст. Укажите OZON_APP_SCOPE или передайте идентификаторы аргументами.");
    return;
  }
  if (cmd === "exchange") {
    const code = rest[0];
    if (!code) throw new Error("usage: oauth.ts exchange <code>");
    const r = await createTokenStore(cfg, { prisma }).exchangeCode(code);
    console.log(`Готово: токен сохранён в БД, действует ${r.expiresIn} с; scope: ${r.scope ?? "—"}`);
    return;
  }
  throw new Error("usage: oauth.ts url [scope ...] | exchange <code> | status");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
