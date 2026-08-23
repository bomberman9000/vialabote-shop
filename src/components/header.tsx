"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useCart } from "@/lib/cart-context";

export function Header() {
  const { data: session } = useSession();
  const { totalCount } = useCart();

  return (
    <header className="bg-brand-900 text-brand-50">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <Link href="/" className="flex flex-col leading-none">
          <span className="font-display text-2xl tracking-[0.15em] text-gold-300">ВИА</span>
          <span className="font-display text-2xl tracking-[0.15em]">ЛАБОТЕ</span>
        </Link>

        <nav className="hidden gap-8 text-sm font-medium uppercase tracking-wide text-brand-200 md:flex">
          <Link href="/catalog" className="hover:text-gold-300">
            Каталог
          </Link>
          <Link href="/#about" className="hover:text-gold-300">
            О бренде
          </Link>
          <Link href="/#delivery" className="hover:text-gold-300">
            Доставка и оплата
          </Link>
        </nav>

        <div className="flex items-center gap-4 text-sm">
          {session?.user ? (
            <>
              <Link href="/account" className="text-brand-200 hover:text-gold-300">
                {session.user.name || session.user.email}
              </Link>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="text-brand-400 hover:text-gold-300"
              >
                Выйти
              </button>
            </>
          ) : (
            <Link href="/account/login" className="text-brand-200 hover:text-gold-300">
              Войти
            </Link>
          )}
          <Link href="/cart" className="btn-gold">
            Корзина{totalCount > 0 ? ` (${totalCount})` : ""}
          </Link>
        </div>
      </div>
    </header>
  );
}
