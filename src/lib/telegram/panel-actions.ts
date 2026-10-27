// Действия панели (кнопки "a:<op>…"): карточка товара, редактор остатка, статистика по периодам,
// запуск ввода, запрос подтверждения. Здесь НЕТ записи товара: максимум — создаётся
// PendingConfirmation / ожидание ввода. Сама правка — только после «Подтвердить»
// (dispatch-command.executeConfirmation).
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/money";
import { canTransition, isProductStatus } from "@/lib/admin/product-lifecycle";
import { buildAction, type PanelAction } from "./callbacks";
import { createPendingConfirmation } from "./confirmation-service";
import { cancelInputs, openInput } from "./input-session";
import { categoryPreview, FIELD_LABEL, FIELD_PROMPT, VISIBILITY, VISIBILITY_RU, visibilityPreview, type TextField } from "./card-edit";
import { applyStep, STOCK_STEPS, stockEditorText, stockPreview } from "./stock";
import { menuScreen, statsScreen, cb, type InlineKeyboard, type PanelScreen } from "./panel";

export type ActionResult = PanelScreen | { toast: string };

export const confirmKeyboard = (confirmationId: string): InlineKeyboard => [
  [
    { text: "✅ Подтвердить", callback_data: `confirm:${confirmationId}` },
    { text: "✖️ Отмена", callback_data: `cancel:${confirmationId}` },
  ],
];

const WRITE_OFF = { toast: "Изменения отключены: проверьте TELEGRAM_ADMIN_IDS и привязку аккаунта." };
const GONE = { toast: "Товар не найден — откройте список заново." };
const cardBtn = (productId: string) => [{ text: "⬅️ К товару", callback_data: buildAction({ op: "card", productId }) }];

async function loadProduct(id: string) {
  return prisma.product.findUnique({ where: { id } });
}

const filled = (v: string | null | undefined) => (v?.trim() ? "заполнено" : "нет");
const short = (v: string | null | undefined, n = 80) => {
  const t = v?.trim() ?? "";
  return t ? `${t.slice(0, n)}${t.length > n ? "…" : ""}` : "нет";
};

async function cardScreen(productId: string, canWrite: boolean): Promise<ActionResult> {
  const p = await prisma.product.findUnique({ where: { id: productId }, include: { category: { select: { name: true } } } });
  if (!p) return GONE;
  const status = (VISIBILITY_RU as Record<string, string>)[p.status] ?? p.status;
  const text = [
    `📦 ${p.title}`,
    `Цена: ${formatPrice(p.price)}${p.oldPrice ? ` (старая ${formatPrice(p.oldPrice)})` : ""}`,
    `Остаток: ${p.stock} шт.`,
    `Категория: ${p.category?.name ?? "—"}`,
    `Публикация: ${status}`,
    `Описание: ${short(p.description, 160)}`,
    `Состав INCI: ${filled(p.activeIngredients)}`,
    `Применение: ${filled(p.howToUse)}`,
    `Предупреждения: ${filled(p.warnings)}`,
    `Срок годности: ${short(p.shelfLife)}`,
    `Производитель: ${short(p.manufacturer)}`,
    ...(canWrite ? [] : ["", "Режим просмотра: правки отключены."]),
  ].join("\n");
  const keyboard: InlineKeyboard = [];
  if (canWrite) {
    const f = (field: TextField, label: string) => ({
      text: label,
      callback_data: buildAction({ op: "field", productId, field }),
    });
    keyboard.push(
      [{ text: "📉 Остаток", callback_data: buildAction({ op: "stockEdit", productId, draft: p.stock }) }, f("price", "💲 Цена")],
      [f("title", "✏️ Название"), f("desc", "📝 Описание")],
      [{ text: "🗂 Категория", callback_data: buildAction({ op: "catMenu", productId }) }, { text: "🖼 Фото", callback_data: buildAction({ op: "photo", productId }) }],
      [f("inci", "🧪 Состав INCI"), f("howto", "🧴 Применение")],
      [f("warn", "⚠️ Предупреждения"), f("shelf", "⏳ Срок годности")],
      [f("maker", "🏭 Производитель"), { text: "👁 Публикация", callback_data: buildAction({ op: "visMenu", productId }) }],
    );
  }
  keyboard.push([
    { text: "⬅️ Товары", callback_data: cb("products") },
    { text: "⬅️ Меню", callback_data: cb("menu") },
  ]);
  return { text, keyboard };
}

async function stockEditor(productId: string, draftRaw: number, canWrite: boolean): Promise<ActionResult> {
  if (!canWrite) return WRITE_OFF;
  const p = await loadProduct(productId);
  if (!p) return GONE;
  const draft = applyStep(draftRaw, 0);
  const steps = STOCK_STEPS.map((step) => ({
    text: step > 0 ? `+${step}` : `${step}`,
    callback_data: buildAction({ op: "stockEdit", productId, draft: applyStep(draft, step) }),
  }));
  const keyboard: InlineKeyboard = [
    steps,
    [{ text: "✏️ Ввести число", callback_data: buildAction({ op: "stockInput", productId }) }],
  ];
  if (draft !== p.stock) keyboard.push([{ text: `✅ Применить: ${p.stock} → ${draft}`, callback_data: buildAction({ op: "stockApply", productId, draft }) }]);
  keyboard.push(cardBtn(productId), [{ text: "⬅️ Остатки", callback_data: cb("stock") }]);
  return { text: stockEditorText(p.title, p.stock, draft), keyboard };
}

export async function handleAction(action: PanelAction, ctx: { telegramUserId: string; canWrite: boolean; now?: Date }): Promise<ActionResult> {
  const { telegramUserId, canWrite } = ctx;
  switch (action.op) {
    case "stats":
      return statsScreen(action.period, ctx.now ?? new Date());
    case "card":
      return cardScreen(action.productId, canWrite);
    case "cancelInput":
      await cancelInputs(telegramUserId);
      return menuScreen(canWrite);
    default:
      break;
  }
  // всё ниже — правки: только при включённой записи
  if (!canWrite) return WRITE_OFF;

  switch (action.op) {
    case "stockEdit":
      return stockEditor(action.productId, action.draft, canWrite);
    case "stockInput": {
      const p = await loadProduct(action.productId);
      if (!p) return GONE;
      await openInput(telegramUserId, "INPUT_STOCK", p.id, p.version);
      return {
        text: `📉 ${p.title}\nСейчас: ${p.stock} шт.\n\nОтправьте число сообщением: 12 — выставить 12, +5 — добавить 5, -3 — убрать 3.`,
        keyboard: [[{ text: "✖️ Отмена", callback_data: buildAction({ op: "stockEdit", productId: p.id, draft: p.stock }) }]],
      };
    }
    case "stockApply": {
      const p = await loadProduct(action.productId);
      if (!p) return GONE;
      if (action.draft === p.stock) return { toast: "Значение не изменилось." };
      const c = await createPendingConfirmation({
        actorTelegramUserId: telegramUserId,
        commandType: "SET_STOCK",
        entityType: "Product",
        entityId: p.id,
        expectedEntityVersion: p.version,
        payload: { stock: action.draft },
      });
      return { text: `${stockPreview(p.title, p.stock, action.draft)}\n\nПодтвердить запись?`, keyboard: confirmKeyboard(c.id) };
    }
    case "field": {
      const p = await loadProduct(action.productId);
      if (!p) return GONE;
      await openInput(telegramUserId, "INPUT_FIELD", p.id, p.version, { field: action.field });
      return {
        text: `✏️ ${p.title} — ${FIELD_LABEL[action.field].toLowerCase()}\n\n${FIELD_PROMPT[action.field]}\nПотом покажу «было → станет» и спрошу подтверждение.`,
        keyboard: [cardBtn(p.id)],
      };
    }
    case "photo": {
      const p = await loadProduct(action.productId);
      if (!p) return GONE;
      await openInput(telegramUserId, "INPUT_PHOTO", p.id, p.version);
      return {
        text: `🖼 ${p.title}\n\nОтправьте новое главное фото: квадрат от 1200×1200 до 4000×4000, до 5 МБ. Лучше «как файл» — Telegram не сожмёт снимок.\nПотом покажу предпросмотр и спрошу подтверждение.`,
        keyboard: [cardBtn(p.id)],
      };
    }
    case "visMenu": {
      const p = await loadProduct(action.productId);
      if (!p) return GONE;
      const targets = VISIBILITY.filter((v) => v !== p.status && isProductStatus(p.status) && canTransition(p.status, v));
      return {
        text: `👁 ${p.title}\nСейчас: ${(VISIBILITY_RU as Record<string, string>)[p.status] ?? p.status}`,
        keyboard: [
          ...targets.map((v) => [{ text: `→ ${VISIBILITY_RU[v]}`, callback_data: buildAction({ op: "vis", productId: p.id, to: v }) }]),
          cardBtn(p.id),
        ],
      };
    }
    case "catMenu": {
      const p = await prisma.product.findUnique({ where: { id: action.productId }, include: { category: { select: { name: true } } } });
      if (!p) return GONE;
      const cats = await prisma.category.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" }, take: 40 });
      const others = cats.filter((c) => c.id !== p.categoryId);
      return {
        text: `🗂 ${p.title}\nСейчас: ${p.category?.name ?? "—"}\n\n${others.length ? "Выберите новую категорию:" : "Других категорий нет — создайте её в Web Admin."}`,
        keyboard: [...others.map((c) => [{ text: c.name, callback_data: buildAction({ op: "catSet", productId: p.id, categoryId: c.id }) }]), cardBtn(p.id)],
      };
    }
    case "catSet": {
      const p = await prisma.product.findUnique({ where: { id: action.productId }, include: { category: { select: { name: true } } } });
      if (!p) return GONE;
      const target = await prisma.category.findUnique({ where: { id: action.categoryId } });
      if (!target) return { toast: "Категория не найдена — откройте список заново." };
      if (target.id === p.categoryId) return { toast: "Товар уже в этой категории." };
      const c = await createPendingConfirmation({
        actorTelegramUserId: telegramUserId,
        commandType: "EDIT_CATEGORY",
        entityType: "Product",
        entityId: p.id,
        expectedEntityVersion: p.version,
        payload: { categoryId: target.id },
      });
      return { text: `${categoryPreview(p.title, p.category?.name ?? "—", target.name)}\n\nПодтвердить?`, keyboard: confirmKeyboard(c.id) };
    }
    case "vis": {
      const p = await loadProduct(action.productId);
      if (!p) return GONE;
      if (!isProductStatus(p.status) || !canTransition(p.status, action.to)) return { toast: "Такой переход недоступен." };
      if (action.to === "published" && p.price <= 0) return { toast: "Нельзя опубликовать без цены — сначала задайте цену." };
      const c = await createPendingConfirmation({
        actorTelegramUserId: telegramUserId,
        commandType: "SET_VISIBILITY",
        entityType: "Product",
        entityId: p.id,
        expectedEntityVersion: p.version,
        payload: { to: action.to },
      });
      return { text: `${visibilityPreview(p.title, p.status, action.to)}\n\nПодтвердить?`, keyboard: confirmKeyboard(c.id) };
    }
  }
}
