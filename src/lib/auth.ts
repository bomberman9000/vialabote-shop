import { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

/**
 * Secure-cookie ставится на https. Имя cookie у next-auth зависит от схемы запроса
 * (префикс __Secure-), поэтому здесь считаем так же: в production — всегда https
 * (имя и Secure-флаг боевого релиза не меняются, сессии не вылетают), в разработке — по NEXTAUTH_URL.
 */
const secureCookies =
  process.env.NODE_ENV === "production" ? true : (process.env.NEXTAUTH_URL ?? "").startsWith("https://");

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  cookies: {
    // Сессионная cookie (audit-2026-11-07: к.33): SameSite=strict вместо next-auth-овского lax.
    // lax-cookie уходит на cross-site top-level GET и на запросы с соседнего поддомена того же
    // сайта — этого мало, когда сама cookie является полномочием; strict уходит только на
    // same-origin запросы.
    //
    // Вход не ломается: cookie ставится ответом callback-а, а следующий переход — свой
    // (same-origin) → cookie уходит. Побочный эффект: первая заходка по ВНЕШНЕЙ ссылке
    // (письмо, Telegram) придёт без сессии — на /account покупатель увидит «войти» и войдёт
    // со второго клика. Страница оплаты (/checkout/pay/<номер>) от сессии не зависит: она
    // открывается по номеру заказа, поэтому оплата по ссылке из письма банка не ломается.
    sessionToken: {
      name: `${secureCookies ? "__Secure-" : ""}next-auth.session-token`,
      options: { httpOnly: true, sameSite: "strict", path: "/", secure: secureCookies },
    },
  },
  pages: {
    signIn: "/account/login",
  },
  providers: [
    CredentialsProvider({
      name: "Email и пароль",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Пароль", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase() },
        });
        if (!user) return null;

        const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!isValid) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
};
