// Первичная авторизация частного приложения Ozon (методы доставки принимают только OAuth-токен).
// Токены пишутся в БД (OzonOAuthToken) и в консоль не выводятся.
//
//   npx tsx scripts/ozon/oauth.ts url [scope ...]   ссылка авторизации (открыть в браузере, где вход в кабинет Ozon)
//   npx tsx scripts/ozon/oauth.ts exchange <code>   обменять code из адреса redirect_uri на токены
//   npx tsx scripts/ozon/oauth.ts status            есть ли токен, до какого времени, scope
// Окружение — как у сервиса (/etc/vialabote-shop/app.env): OZON_APP_CLIENT_ID, OZON_APP_CLIENT_SECRET, OZON_APP_REDIRECT_URI.
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ozonConfig } from "@/lib/delivery/ozon";
import { createTokenStore } from "@/lib/delivery/ozon-token";

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const cfg = ozonConfig();
  if (!cfg) throw new Error("Нет OZON_APP_CLIENT_ID / OZON_APP_CLIENT_SECRET");

  if (cmd === "url") {
    if (!cfg.app.redirectUri) throw new Error("Нет OZON_APP_REDIRECT_URI (тот же адрес, что в настройках приложения)");
    const scope = rest.length ? rest.join(" ") : (process.env.OZON_APP_SCOPE ?? "");
    const q = new URLSearchParams({
      response_type: "code",
      access_type: "offline", // иначе Ozon не вернёт refresh_token
      client_id: cfg.app.clientId,
      redirect_uri: cfg.app.redirectUri,
      ...(scope ? { scope } : {}),
      state: randomBytes(12).toString("hex"),
    });
    console.log(`https://seller.ozon.ru/app/appstore/oauth/authorize?${q}`);
    console.log("После согласия Ozon откроет redirect_uri с ?code=…&state=… — state должен совпасть с этим.");
    return;
  }
  if (cmd === "exchange") {
    const code = rest[0];
    if (!code) throw new Error("usage: oauth.ts exchange <code>");
    const r = await createTokenStore(cfg, { prisma }).exchangeCode(code);
    console.log(`Готово: токен сохранён в БД, действует ${r.expiresIn} с; scope: ${r.scope ?? "—"}`);
    return;
  }
  if (cmd === "status") {
    const row = await prisma.ozonOAuthToken.findUnique({ where: { id: "seller" }, select: { expiresAt: true, scope: true, updatedAt: true } });
    console.log(row ? `токен есть; access до ${row.expiresAt?.toISOString() ?? "—"}; обновлён ${row.updatedAt.toISOString()}; scope: ${row.scope ?? "—"}` : "токена нет");
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
