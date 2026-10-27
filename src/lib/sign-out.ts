import { signOut } from "next-auth/react";

// NextAuth строит адрес возврата от NEXTAUTH_URL. За nginx это внутренний
// адрес приложения (на бою http://127.0.0.1:3002), и signOut({ callbackUrl })
// уводил браузер покупателя туда — на недоступную страницу. Поэтому сессию
// гасим без серверного редиректа, а уходим относительным путём: полная
// загрузка страницы сбрасывает и кэш роутера, где ещё лежит кабинет.
export async function signOutToHome(go: (path: string) => void = (path) => window.location.assign(path)) {
  await signOut({ redirect: false });
  go("/");
}
