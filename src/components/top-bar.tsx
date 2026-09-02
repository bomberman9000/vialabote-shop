import { Truck, ShieldCheck, BadgeCheck } from "lucide-react";

const TOP_BAR_ITEMS = [
  { icon: Truck, label: "Бесплатная доставка от 5 000 ₽" },
  { icon: ShieldCheck, label: "Оригинальная продукция" },
  { icon: BadgeCheck, label: "Дерматологически протестировано" },
];

export function TopBar() {
  return (
    <div className="bg-brand-900 text-brand-100">
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-4 overflow-x-auto px-4 py-2.5 text-[11px] sm:gap-8 sm:text-xs">
        {TOP_BAR_ITEMS.map((item, i) => (
          <div key={item.label} className="flex shrink-0 items-center gap-4 sm:gap-8">
            {i > 0 ? <span className="text-gold-400/60">•</span> : null}
            <span className="flex items-center gap-2 whitespace-nowrap">
              <item.icon size={14} strokeWidth={1.6} className="text-gold-400" aria-hidden="true" />
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
