"use client";

import Link from "next/link";
import Image from "next/image";
import { Search, UserRound, ShoppingBag, Menu } from "lucide-react";
import { useSession, signOut } from "next-auth/react";
import { useCart } from "@/lib/cart-context";
import { RoutineFinderTrigger } from "@/components/routine-finder/routine-finder-trigger";

export function Header() {
  const { data: session } = useSession();
  const { totalCount } = useCart();

  return (
    <header className="sticky top-0 z-40 border-b border-brand-100/70 bg-[#FAF6EE]">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-4 sm:px-6">
        {/* Мобильное меню */}
        <button
          type="button"
          aria-label="Меню"
          className="text-brand-900 transition-colors hover:text-gold-500 md:hidden"
        >
          <Menu size={22} strokeWidth={1.6} />
        </button>

        {/* Логотип: эмблема + wordmark + тэглайн */}
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/images/logo-emblem.png"
            alt=""
            width={404}
            height={553}
            className="h-11 w-auto sm:h-14"
            priority
          />
          <span className="flex flex-col leading-none">
            <span className="text-lg font-semibold tracking-[0.12em] text-brand-900 sm:text-2xl">
              VIA LABOTE
            </span>
            <span className="mt-1 hidden text-[9px] font-semibold uppercase tracking-[0.16em] text-gold-500 sm:block sm:text-[10px]">
              Наука. Природа. Гармония.
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-8 text-[13px] font-semibold uppercase tracking-[0.08em] text-brand-800 lg:flex">
          <Link href="/catalog" className="transition-colors hover:text-gold-500">
            Каталог
          </Link>
          <RoutineFinderTrigger className="uppercase tracking-[0.08em] transition-colors hover:text-gold-500">
            Подобрать уход
          </RoutineFinderTrigger>
          <Link href="/#about" className="transition-colors hover:text-gold-500">
            О бренде
          </Link>
        </nav>

        <div className="flex items-center gap-4 text-brand-900 sm:gap-5">
          <button
            type="button"
            aria-label="Поиск"
            className="hidden transition-colors hover:text-gold-500 sm:block"
          >
            <Search size={20} strokeWidth={1.6} />
          </button>
          <Link
            href={session?.user ? "/account" : "/account/login"}
            aria-label={session?.user ? "Личный кабинет" : "Войти"}
            className="transition-colors hover:text-gold-500"
          >
            <UserRound size={20} strokeWidth={1.6} />
          </Link>
          <Link
            href="/cart"
            aria-label="Корзина"
            className="relative transition-colors hover:text-gold-500"
          >
            <ShoppingBag size={20} strokeWidth={1.6} />
            {totalCount > 0 ? (
              <span className="absolute -right-2 -top-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-gold-400 px-1 text-[10px] font-bold text-brand-900">
                {totalCount}
              </span>
            ) : null}
          </Link>
          {session?.user ? (
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="hidden text-xs text-brand-400 transition-colors hover:text-gold-500 xl:block"
            >
              Выйти
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
