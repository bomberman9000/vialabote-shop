import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { CartProvider } from "@/lib/cart-context";
import { Header } from "@/components/header";
import { TopBar } from "@/components/top-bar";
import { Footer } from "@/components/footer";
import { AuthProvider } from "@/components/auth-provider";
import { RoutineFinderProvider } from "@/components/routine-finder/routine-finder-context";
import { RoutineFinderWidget } from "@/components/routine-finder/routine-finder-widget";
import { getRoutineProducts } from "@/lib/get-routine-products";

export const metadata: Metadata = {
  title: "Vialabote — интернет-магазин косметики",
  description: "Собственный интернет-магазин Vialabote: уход и косметика с доставкой по России.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const routineProducts = await getRoutineProducts();

  return (
    <html lang="ru">
      <body>
        <AuthProvider>
          <CartProvider>
            {/* useSearchParams внутри провайдера требует Suspense-границы —
                иначе Next.js не сможет статически рендерить часть страниц. */}
            <Suspense fallback={null}>
              <RoutineFinderProvider products={routineProducts}>
                <TopBar />
                <Header />
                <main className="mx-auto min-h-[70vh] max-w-7xl px-4 py-8">{children}</main>
                <Footer />
                <RoutineFinderWidget />
              </RoutineFinderProvider>
            </Suspense>
          </CartProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
