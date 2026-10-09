"use client";

import { useId, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Search, UserRound, ShoppingBag, Menu, X } from "lucide-react";
import { useSession, signOut } from "next-auth/react";
import { useCart } from "@/lib/cart-context";
import { RoutineFinderTrigger } from "@/components/routine-finder/routine-finder-trigger";
import { useRoutineFinder } from "@/components/routine-finder/routine-finder-context";
import { AccessibleDialog } from "@/components/routine-finder/accessible-dialog";
import { SearchDialog } from "@/components/search-dialog";
import type { SearchProduct } from "@/lib/search";

const ICON_BTN =
  "flex h-11 w-11 items-center justify-center rounded-full text-brand-900 transition-colors hover:text-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400";

export function Header({ searchProducts }: { searchProducts: SearchProduct[] }) {
  const { data: session } = useSession();
  const { totalCount } = useCart();
  const finder = useRoutineFinder();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const menuTitleId = useId();

  const accountHref = session?.user ? "/account" : "/account/login";
  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="sticky top-0 z-40 border-b border-brand-100/70 bg-[#FAF6EE]/95 backdrop-blur supports-[backdrop-filter]:bg-[#FAF6EE]/85">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-2 py-3 sm:px-6 sm:py-4">
        <button
          type="button"
          aria-label="Открыть меню"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
          className={`${ICON_BTN} lg:hidden`}
        >
          <Menu size={22} strokeWidth={1.6} aria-hidden="true" />
        </button>

        {/* Логотип: эмблема + wordmark + тэглайн */}
        <Link href="/" className="flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400">
          <Image
            src="/images/logo-emblem.png"
            alt=""
            width={41}
            height={56}
            className="h-11 w-auto sm:h-14"
            priority
          />
          <span className="flex flex-col leading-none">
            <span className="text-lg font-semibold tracking-[0.12em] text-brand-900 sm:text-2xl">VIA LABOTE</span>
            <span className="mt-1 hidden text-[9px] font-semibold uppercase tracking-[0.16em] text-gold-500 sm:block sm:text-[10px]">
              Наука. Природа. Гармония.
            </span>
          </span>
        </Link>

        <nav aria-label="Основная навигация" className="hidden items-center gap-8 text-[13px] font-semibold uppercase tracking-[0.08em] text-brand-800 lg:flex">
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

        <div className="flex items-center sm:gap-1">
          <button
            type="button"
            aria-label="Поиск"
            aria-haspopup="dialog"
            onClick={() => setSearchOpen(true)}
            className={ICON_BTN}
          >
            <Search size={20} strokeWidth={1.6} aria-hidden="true" />
          </button>
          <Link
            href={accountHref}
            aria-label={session?.user ? "Личный кабинет" : "Войти"}
            className={`${ICON_BTN} hidden sm:flex`}
          >
            <UserRound size={20} strokeWidth={1.6} aria-hidden="true" />
          </Link>
          <Link href="/cart" aria-label={`Корзина${totalCount > 0 ? `, товаров: ${totalCount}` : ""}`} className={`${ICON_BTN} relative`}>
            <ShoppingBag size={20} strokeWidth={1.6} aria-hidden="true" />
            {totalCount > 0 ? (
              <span className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-gold-400 px-1 text-[10px] font-bold text-brand-900">
                {totalCount}
              </span>
            ) : null}
          </Link>
          {session?.user ? (
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="ml-2 hidden text-xs text-brand-400 transition-colors hover:text-gold-500 xl:block"
            >
              Выйти
            </button>
          ) : null}
        </div>
      </div>

      {/* Мобильное меню: нативный <dialog> — focus trap, Escape, scroll lock */}
      <AccessibleDialog open={menuOpen} onClose={closeMenu} labelledBy={menuTitleId} variant="drawer">
        <div className="flex items-center justify-between border-b border-brand-100 px-5 py-4">
          <p id={menuTitleId} className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-900">
            Меню
          </p>
          <button type="button" onClick={closeMenu} aria-label="Закрыть меню" className={ICON_BTN}>
            <X size={22} strokeWidth={1.6} aria-hidden="true" />
          </button>
        </div>
        <nav aria-label="Мобильная навигация" className="flex flex-col px-3 py-4">
          <Link
            href="/catalog"
            onClick={closeMenu}
            className="group flex min-h-12 items-center justify-between rounded-xl px-3 text-lg font-bold text-brand-900 transition-colors hover:bg-white"
          >
            Каталог
            <ArrowRight size={18} strokeWidth={1.6} aria-hidden="true" className="text-gold-500 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <button
            type="button"
            onClick={() => {
              closeMenu();
              finder.open();
            }}
            className="group flex min-h-12 items-center justify-between rounded-xl px-3 text-left text-lg font-bold text-brand-900 transition-colors hover:bg-white"
          >
            Подобрать уход
            <ArrowRight size={18} strokeWidth={1.6} aria-hidden="true" className="text-gold-500 transition-transform group-hover:translate-x-0.5" />
          </button>
          <Link
            href="/#about"
            onClick={closeMenu}
            className="group flex min-h-12 items-center justify-between rounded-xl px-3 text-lg font-bold text-brand-900 transition-colors hover:bg-white"
          >
            О бренде
            <ArrowRight size={18} strokeWidth={1.6} aria-hidden="true" className="text-gold-500 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </nav>
        <div className="mt-auto flex flex-col gap-1 border-t border-brand-100 px-3 py-4 text-sm font-semibold text-brand-700">
          <Link href={accountHref} onClick={closeMenu} className="flex min-h-12 items-center gap-3 rounded-xl px-3 hover:bg-white">
            <UserRound size={18} strokeWidth={1.6} aria-hidden="true" />
            {session?.user ? "Личный кабинет" : "Войти"}
          </Link>
          <Link href="/cart" onClick={closeMenu} className="flex min-h-12 items-center gap-3 rounded-xl px-3 hover:bg-white">
            <ShoppingBag size={18} strokeWidth={1.6} aria-hidden="true" />
            Корзина{totalCount > 0 ? ` · ${totalCount}` : ""}
          </Link>
          {session?.user ? (
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/" })}
              className="flex min-h-12 items-center rounded-xl px-3 text-left text-brand-400 hover:bg-white"
            >
              Выйти
            </button>
          ) : null}
        </div>
      </AccessibleDialog>

      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} products={searchProducts} />
    </header>
  );
}
