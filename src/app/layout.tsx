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
            {/* Никакой <Suspense> вокруг {children}: граница здесь заставляла
                Next отдавать shell со статусом 200 до рендера страницы, и
                notFound() внутри неё уже не мог изменить статус — 404-страницы
                отдавались как soft-404 (HTTP 200). RoutineFinderProvider больше
                не вызывает useSearchParams, поэтому граница не нужна. */}
            <RoutineFinderProvider products={routineProducts}>
              <TopBar />
              <Header />
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
