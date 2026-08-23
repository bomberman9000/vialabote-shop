import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/money";
import { NewProductForm } from "./new-product-form";
import { ProductRowActions } from "./product-row-actions";
import { resolveDisplayPrice } from "@/lib/pricing/product-price";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage() {
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    include: { category: true, discount: true },
  });

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold text-brand-800">Товары</h1>

      <NewProductForm />

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-brand-100 text-brand-500">
              <th className="py-2 pr-4">Название</th>
              <th className="py-2 pr-4">Категория</th>
              <th className="py-2 pr-4">Цена</th>
              <th className="py-2 pr-4">Остаток</th>
              <th className="py-2 pr-4">Активен</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              // Админ видит ОБЕ цены: базовую (source of truth, из setPrice) и,
              // если скидка сейчас активна, реальную цену к оплате — иначе
              // легко "потерять" факт, что цена уже не совпадает с product.price.
              const display = resolveDisplayPrice(p);
              return (
                <tr key={p.id} className="border-b border-brand-50">
                  <td className="py-2 pr-4">
                    <Link href={`/admin/products/${p.id}`} className="text-brand-700 hover:underline">
                      {p.title}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{p.category.name}</td>
                  <td className="py-2 pr-4">
                    {formatPrice(p.price)}
                    {display.discountApplied ? (
                      <span className="ml-2 rounded-full bg-gold-100 px-2 py-0.5 text-xs text-brand-700">
                        сейчас {formatPrice(display.price)}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4">{p.stock}</td>
                  <td className="py-2 pr-4">{p.isActive ? "Да" : "Нет"}</td>
                  <td className="py-2 pr-4">
                    <ProductRowActions productId={p.id} isActive={p.isActive} version={p.version} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
