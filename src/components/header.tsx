"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useCart } from "@/lib/cart-context";

export function Header() {
  const { data: session } = useSession();
  const { totalCount } = useCart();

  return (
    <header className="border-b border-brand-100 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Link href="/" className="text-xl font-semibold tracking-wide text-brand-700">
          Vialabote
        </Link>

        <nav className="hidden gap-6 text-sm font-medium text-brand-700 md:flex">
          <Link href="/catalog">Каталог</Link>
          <Link href="/#about">О нас</Link>
          <Link href="/#delivery">Доставка и оплата</Link>
        </nav>

        <div className="flex items-center gap-4 text-sm">
          {session?.user ? (
            <>
              <Link href="/account" className="text-brand-700 hover:underline">
                {session.user.name || session.user.email}
              </Link>
              <button onClick={() => signOut({ callbackUrl: "/" })} className="text-brand-500 hover:underline">
                Выйти
              </button>
            </>
          ) : (
            <Link href="/account/login" className="text-brand-700 hover:underline">
              Войти
            </Link>
          )}
          <Link href="/cart" className="btn-primary">
            Корзина{totalCount > 0 ? ` (${totalCount})` : ""}
          </Link>
        </div>
      </div>
    </header>
  );
}
