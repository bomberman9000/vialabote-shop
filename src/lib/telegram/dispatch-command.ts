// Единственный маршрутизатор "текст оператора -> typed command -> preview ->
// confirm -> application service". НИКОГДА не пишет в Prisma напрямую —
// вся мутация идёт через src/lib/admin/commands/*, как и Web Admin.
import { prisma } from "@/lib/prisma";
import { AdminCommandError } from "@/lib/admin/errors";
import { parseCommand, type ParsedCommand } from "./command-parser";
import { resolveProductByQuery, type ProductCandidate } from "./entity-resolver";
import { resolveTelegramActor, toAdminActor } from "./actor-resolver";
import { createPendingConfirmation, consumeConfirmation, cancelConfirmation } from "./confirmation-service";
import { setPrice, setDiscount, publishProduct, archiveProduct } from "@/lib/admin/commands/product";
import { effectivePrice } from "@/lib/pricing/effective-price";
import { formatPrice } from "@/lib/money";

export type DispatchResult =
  | { kind: "not_authorized" }
  | { kind: "unknown_command" }
  | { kind: "ambiguous_command"; reason: string }
  | { kind: "entity_not_found"; query: string }
  | { kind: "entity_ambiguous"; candidates: ProductCandidate[] }
  | { kind: "unsupported"; message: string }
  | { kind: "immediate_result"; text: string }
  | { kind: "confirmation_required"; confirmationId: string; previewText: string };

function resolveYearlessDate(day: number, month: number, now: Date): Date {
  const year = now.getFullYear();
  let candidate = new Date(Date.UTC(year, month - 1, day, 23, 59, 59));
  if (candidate.getTime() < now.getTime()) {
    candidate = new Date(Date.UTC(year + 1, month - 1, day, 23, 59, 59));
  }
  return candidate;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface PreparedMutation {
  commandType: string;
  payload: Record<string, unknown>;
  previewText: string;
}

function prepareMutation(intent: ParsedCommand, product: ProductCandidate, now: Date): PreparedMutation | null {
  switch (intent.type) {
    case "SET_PRICE": {
      // Оператор пишет цену в рублях ("цена X 2190" = 2190 ₽), а
      // Product.price хранится в копейках (та же единица, что и Web Admin
      // форма, и effectivePrice()) — конвертация ЗДЕСЬ, один раз.
      const priceKopecks = Math.round(intent.price * 100);
      return {
        commandType: "SET_PRICE",
        payload: { price: priceKopecks },
        previewText: `Установить цену «${product.title}»: ${formatPrice(priceKopecks)}`,
      };
    }
    case "SET_DISCOUNT": {
      const endsAt = intent.endsAt ? resolveYearlessDate(intent.endsAt.day, intent.endsAt.month, now) : null;
      // Preview считает через ТУ ЖЕ effectivePrice(), что и /api/orders — это
      // гарантирует, что оператор в Telegram видит РОВНО ту цену, которую
      // после подтверждения увидит покупатель на checkout, а не отдельный
      // параллельный расчёт.
      const preview = effectivePrice(product.price, {
        type: intent.discountType,
        value: intent.value,
        startsAt: null,
        endsAt,
      }, now);
      return {
        commandType: "SET_DISCOUNT",
        payload: {
          type: intent.discountType,
          value: intent.value,
          startsAt: null,
          endsAt,
        },
        previewText:
          `Скидка «${product.title}»: ${intent.value}${intent.discountType === "percent" ? "%" : "₽"}` +
          (endsAt ? ` до ${formatDate(endsAt)}` : " (бессрочно)") +
          ` → цена станет ${formatPrice(preview.effectivePrice)} (была ${formatPrice(preview.originalPrice)})`,
      };
    }
    case "PUBLISH_PRODUCT":
      return {
        commandType: "PUBLISH_PRODUCT",
        payload: {},
        previewText: `Опубликовать «${product.title}» (текущий статус: ${product.status})`,
      };
    case "ARCHIVE_PRODUCT":
      return {
        commandType: "ARCHIVE_PRODUCT",
        payload: {},
        previewText: `Скрыть/архивировать «${product.title}» (текущий статус: ${product.status})`,
      };
    default:
      return null;
  }
}

async function runMutationCommand(actorTelegramUserId: string, commandType: string, payload: Record<string, unknown>) {
  const resolved = await resolveTelegramActor(actorTelegramUserId);
  if (!resolved) {
    throw new AdminCommandError("FORBIDDEN", "Telegram-аккаунт не привязан к администратору");
  }
  const actor = toAdminActor(resolved);

  switch (commandType) {
    case "SET_PRICE":
      return setPrice(actor, payload);
    case "SET_DISCOUNT":
      // payload прошёл через JSON.stringify/parse внутри PendingConfirmation —
      // Date стал ISO-строкой, а setDiscount's Zod-схема требует z.date().
      // Восстанавливаем Date здесь, в единственном месте десериализации.
      return setDiscount(actor, {
        ...payload,
        startsAt: payload.startsAt ? new Date(payload.startsAt as string) : null,
        endsAt: payload.endsAt ? new Date(payload.endsAt as string) : null,
      });
    case "PUBLISH_PRODUCT":
      return publishProduct(actor, payload);
    case "ARCHIVE_PRODUCT":
      return archiveProduct(actor, payload);
    default:
      throw new AdminCommandError("VALIDATION", `Неизвестный тип команды: ${commandType}`);
  }
}

/** Шаг 1: разбор + resolve + preview. НИЧЕГО не мутирует. */
export async function prepareCommand(actorTelegramUserId: string, rawText: string): Promise<DispatchResult> {
  const resolvedActor = await resolveTelegramActor(actorTelegramUserId);
  if (!resolvedActor || resolvedActor.role !== "ADMIN") {
    return { kind: "not_authorized" };
  }

  const intent = parseCommand(rawText);

  if (intent.type === "UNKNOWN") return { kind: "unknown_command" };
  if (intent.type === "AMBIGUOUS") return { kind: "ambiguous_command", reason: intent.reason };

  if (intent.type === "LIST_PRODUCTS_MISSING_INCI") {
    // Read-only — не мутирует, confirmation не нужна. "INCI" сопоставлен с
    // единственным существующим полем состава — activeIngredients.
    const products = await prisma.product.findMany({
      where: { activeIngredients: null, status: { not: "archived" } },
      select: { title: true, slug: true },
      orderBy: { title: "asc" },
    });
    const text =
      products.length === 0
        ? "Все активные товары содержат состав (INCI)."
        : `Товары без состава (INCI):\n${products.map((p) => `• ${p.title} (${p.slug})`).join("\n")}`;
    return { kind: "immediate_result", text };
  }

  if (intent.type === "CREATE_BANNER") {
    // Баннер требует медиафайла (обязательное поле desktopMediaId), а
    // текстовая команда его дать не может — эта итерация не реализует приём
    // фото через Telegram. Явно и честно сообщаем об ограничении, не
    // притворяемся, что команда сработала.
    return {
      kind: "unsupported",
      message:
        "Создание баннера через Telegram-текст пока не поддерживается — баннеру нужно изображение. " +
        "Используйте Web Admin, либо дождитесь добавления приёма фото в боте.",
    };
  }

  // Оставшиеся типы (SET_DISCOUNT/SET_PRICE/PUBLISH_PRODUCT/ARCHIVE_PRODUCT) —
  // все требуют productQuery -> resolve.
  const productQuery = "productQuery" in intent ? intent.productQuery : null;
  if (!productQuery) return { kind: "unknown_command" };

  const resolution = await resolveProductByQuery(productQuery);
  if (resolution.status === "not_found") return { kind: "entity_not_found", query: productQuery };
  if (resolution.status === "ambiguous") return { kind: "entity_ambiguous", candidates: resolution.candidates };

  const prepared = prepareMutation(intent, resolution.product, new Date());
  if (!prepared) return { kind: "unknown_command" };

  const confirmation = await createPendingConfirmation({
    actorTelegramUserId,
    commandType: prepared.commandType,
    entityType: "Product",
    entityId: resolution.product.id,
    expectedEntityVersion: resolution.product.version,
    payload: prepared.payload,
  });

  return { kind: "confirmation_required", confirmationId: confirmation.id, previewText: prepared.previewText };
}

export interface ExecuteOutcome {
  ok: boolean;
  message: string;
}

/** Шаг 2: оператор нажал "Подтвердить" — единственное место, где происходит мутация. */
export async function executeConfirmation(actorTelegramUserId: string, confirmationId: string): Promise<ExecuteOutcome> {
  let consumed;
  try {
    consumed = await consumeConfirmation(confirmationId, actorTelegramUserId);
  } catch (err) {
    if (err instanceof AdminCommandError) return { ok: false, message: err.message };
    throw err;
  }

  const confirmation = await prisma.pendingConfirmation.findUniqueOrThrow({ where: { id: confirmationId } });
  const payload = {
    productId: confirmation.entityId,
    expectedVersion: confirmation.expectedEntityVersion,
    ...(consumed.payload as Record<string, unknown>),
  };

  try {
    await runMutationCommand(actorTelegramUserId, confirmation.commandType, payload);
    return { ok: true, message: "Готово." };
  } catch (err) {
    if (err instanceof AdminCommandError) return { ok: false, message: err.message };
    throw err;
  }
}

export async function declineConfirmation(actorTelegramUserId: string, confirmationId: string): Promise<void> {
  await cancelConfirmation(confirmationId, actorTelegramUserId);
}
