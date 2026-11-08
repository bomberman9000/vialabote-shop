// Уведомление владельцу в Telegram о судьбе оплаты. Получатели — TELEGRAM_ADMIN_IDS (личные чаты),
// отправка через тот же Bot API, что и у бота (TELEGRAM_API_BASE — на сервере Telegram доступен
// только через него). Ошибка отправки не должна влиять на заказ: только лог, без токена.
import { formatPrice } from "@/lib/money";
import { parseAdminIds } from "@/lib/telegram/access";
import type { FetchLike } from "@/lib/tochka";
import type { OrderRow, SyncOutcome } from "./online-order";

type Env = Record<string, string | undefined>;

export function ownerMessage(order: Pick<OrderRow, "number" | "totalAmount">, outcome: SyncOutcome): string | null {
  const sum = formatPrice(order.totalAmount);
  if (outcome === "PAID") return `💳 Оплачен заказ ${order.number} на ${sum}.`;
  if (outcome === "PAID_LATE")
    return `⚠️ Заказ ${order.number} на ${sum} оплачен ПОСЛЕ истечения 10 минут — резерв уже был снят. Проверьте наличие.`;
  if (outcome === "AMOUNT_MISMATCH") return `⚠️ Заказ ${order.number}: банк подтвердил сумму, отличную от ${sum}. Нужна ручная проверка.`;
  return null;
}

export async function notifyOwner(
  order: Pick<OrderRow, "number" | "totalAmount">,
  outcome: SyncOutcome,
  { env = process.env as Env, fetchImpl = fetch as FetchLike }: { env?: Env; fetchImpl?: FetchLike } = {},
): Promise<number> {
  const text = ownerMessage(order, outcome);
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const ids = parseAdminIds(env.TELEGRAM_ADMIN_IDS);
  if (!text || !token || ids.length === 0) return 0;
  const base = (env.TELEGRAM_API_BASE?.trim() || "https://api.telegram.org").replace(/\/$/, "");
  let sent = 0;
  for (const chatId of ids) {
    try {
      const res = await fetchImpl(`${base}/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) sent++;
      else console.error(`[notify] Telegram HTTP ${res.status} для заказа ${order.number}`);
    } catch (err) {
      console.error(`[notify] заказ ${order.number}:`, String(err instanceof Error ? err.message : err).split(token).join("<token>"));
    }
  }
  return sent;
}
