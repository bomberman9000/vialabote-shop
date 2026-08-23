import type { Metadata } from "next";
import "./globals.css";
import { CartProvider } from "@/lib/cart-context";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { AuthProvider } from "@/components/auth-provider";

export const metadata: Metadata = {
  title: "Vialabote — интернет-магазин косметики",
  description: "Собственный интернет-магазин Vialabote: уход и косметика с доставкой по России.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <AuthProvider>
          <CartProvider>
            <Header />
            <main className="mx-auto min-h-[70vh] max-w-6xl px-4 py-8">{children}</main>
            <Footer />
          </CartProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
