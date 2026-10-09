import type { Metadata } from "next";
import "./globals.css";
import { CartProvider } from "@/lib/cart-context";
import { Header } from "@/components/header";
import { TopBar } from "@/components/top-bar";
import { Footer } from "@/components/footer";
import { AuthProvider } from "@/components/auth-provider";
import { RoutineFinderProvider } from "@/components/routine-finder/routine-finder-context";
import { RoutineFinderWidget } from "@/components/routine-finder/routine-finder-widget";
import { getRoutineProducts } from "@/lib/get-routine-products";
import { getSearchProducts } from "@/lib/get-search-products";

export const metadata: Metadata = {
  title: "Vialabote — интернет-магазин косметики",
  description: "Собственный интернет-магазин Vialabote: уход и косметика с доставкой по России.",
  // Знак VIA LABOTE (public/branding/vialabote-favicon.png) -> scripts/media/favicons.mjs.
  // Только эти ссылки: стандартного favicon Next (app/favicon.ico) в проекте нет.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [routineProducts, searchProducts] = await Promise.all([getRoutineProducts(), getSearchProducts()]);

  return (
    <html lang="ru">
      <body>
        <AuthProvider>
          <CartProvider>
            {/* Никакой <Suspense> вокруг {children}: граница здесь заставляла
                Next отдавать shell со статусом 200 до рендера страницы, и
                notFound() внутри неё уже не мог изменить статус — 404-страницы
                отдавались как soft-404 (HTTP 200). RoutineFinderProvider больше
                не вызывает useSearchParams, поэтому граница не нужна. */}
            <RoutineFinderProvider products={routineProducts}>
              <TopBar />
              <Header searchProducts={searchProducts} />
              <main className="mx-auto min-h-[70vh] max-w-7xl px-4 py-8">{children}</main>
              <Footer />
              <RoutineFinderWidget />
            </RoutineFinderProvider>
          </CartProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
