import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/money";
import { NewProductForm } from "./new-product-form";
import { ProductRowActions } from "./product-row-actions";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage() {
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    include: { category: true },
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
            {products.map((p) => (
              <tr key={p.id} className="border-b border-brand-50">
                <td className="py-2 pr-4">{p.title}</td>
                <td className="py-2 pr-4">{p.category.name}</td>
                <td className="py-2 pr-4">{formatPrice(p.price)}</td>
                <td className="py-2 pr-4">{p.stock}</td>
                <td className="py-2 pr-4">{p.isActive ? "Да" : "Нет"}</td>
                <td className="py-2 pr-4">
                  <ProductRowActions productId={p.id} isActive={p.isActive} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
