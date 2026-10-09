// Canonical lifecycle товара. `status` — единственный source of truth.
// `isActive` — legacy compatibility field для существующих storefront-запросов
// (каталог/PDP их не меняли и не обязаны знать про status). isActive НИКОГДА
// не устанавливается независимо — только через deriveIsActive(status) в
// единой точке записи (см. src/lib/admin/commands/*).
export const PRODUCT_STATUSES = ["draft", "published", "archived"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export function isProductStatus(value: string): value is ProductStatus {
  return (PRODUCT_STATUSES as readonly string[]).includes(value);
}

export function deriveIsActive(status: ProductStatus): boolean {
  return status === "published";
}

// Допустимые переходы — публикация из архива разрешена (переиздание),
// но не бывает "тихого" перехода archived -> published мимо явной команды.
const ALLOWED_TRANSITIONS: Record<ProductStatus, ProductStatus[]> = {
  draft: ["published", "archived"],
  published: ["archived", "draft"],
  archived: ["draft", "published"],
};

export function canTransition(from: ProductStatus, to: ProductStatus): boolean {
  if (from === to) return true; // idempotent no-op разрешён
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export interface LifecycleFields {
  status: ProductStatus;
  isActive: boolean;
}

/** Единая точка построения пары status+isActive — используется во ВСЕХ write-путях. */
export function buildLifecycleFields(status: ProductStatus): LifecycleFields {
  return { status, isActive: deriveIsActive(status) };
}
