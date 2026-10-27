const YOOKASSA_API = "https://api.yookassa.ru/v3";

function authHeader(): string {
  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY;
  if (!shopId || !secretKey) {
    throw new Error("YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY не заданы в .env");
  }
  return "Basic " + Buffer.from(`${shopId}:${secretKey}`).toString("base64");
}

export interface ReceiptItem {
  description: string;
  quantity: number;
  amountKopecks: number; // цена за единицу, копейки
}

export interface CreatePaymentParams {
  orderId: string;
  orderNumber: string;
  amountRub: number; // рубли, с копейками
  returnUrl: string;
  description: string;
  customerEmail?: string;
  receiptItems?: ReceiptItem[];
}

export interface YooKassaPayment {
  id: string;
  status: string;
  paid?: boolean;
  amount?: { value: string; currency: string };
  confirmation?: { confirmation_url?: string };
  metadata?: { orderId?: string; orderNumber?: string };
}

/**
 * Идемпотентный ключ платежа: один и тот же заказ при повторной попытке
 * создать платёж получит тот же платёж от ЮKassa, а не второй.
 */
export function paymentIdempotenceKey(orderId: string): string {
  return `vialabote-pay-${orderId}`;
}

/**
 * Позиции чека 54-ФЗ. Включается ТОЛЬКО когда продавец подтвердил параметры:
 *   YOOKASSA_FISCAL_ENABLED=true,
 *   YOOKASSA_TAX_SYSTEM_CODE (1..6, система налогообложения),
 *   YOOKASSA_VAT_CODE (1..6, ставка НДС).
 * Значения — вопрос к бухгалтеру продавца; по умолчанию чек не отправляется.
 */
export function buildReceipt(params: CreatePaymentParams) {
  if (process.env.YOOKASSA_FISCAL_ENABLED !== "true") return undefined;
  const taxSystem = Number(process.env.YOOKASSA_TAX_SYSTEM_CODE);
  const vat = Number(process.env.YOOKASSA_VAT_CODE);
  if (!params.customerEmail || !params.receiptItems?.length || !taxSystem || !vat) {
    throw new Error("Фискализация включена, но не заданы email покупателя, позиции или коды налогообложения");
  }
  return {
    customer: { email: params.customerEmail },
    tax_system_code: taxSystem,
    items: params.receiptItems.map((i) => ({
      description: i.description.slice(0, 128),
      quantity: String(i.quantity),
      amount: { value: (i.amountKopecks / 100).toFixed(2), currency: "RUB" },
      vat_code: vat,
      payment_mode: "full_payment",
      payment_subject: "commodity",
    })),
  };
}

/**
 * Создаёт платёж в ЮKassa. Требует настроенный магазин (shopId/secretKey) —
 * см. README.md, раздел "Онлайн-оплата".
 */
export async function createPayment(params: CreatePaymentParams): Promise<YooKassaPayment> {
  const receipt = buildReceipt(params);
  const res = await fetch(`${YOOKASSA_API}/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(),
      "Idempotence-Key": paymentIdempotenceKey(params.orderId),
    },
    body: JSON.stringify({
      amount: {
        value: params.amountRub.toFixed(2),
        currency: "RUB",
      },
      capture: true,
      confirmation: {
        type: "redirect",
        return_url: params.returnUrl,
      },
      description: params.description,
      metadata: {
        orderId: params.orderId,
        orderNumber: params.orderNumber,
      },
      ...(receipt ? { receipt } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ЮKassa: ошибка создания платежа (${res.status}): ${text}`);
  }

  return (await res.json()) as YooKassaPayment;
}

/** Достоверный статус платежа — запросом к ЮKassa, а не по телу webhook. */
export async function getPayment(paymentId: string): Promise<YooKassaPayment> {
  const res = await fetch(`${YOOKASSA_API}/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: authHeader() },
  });
  if (!res.ok) {
    throw new Error(`ЮKassa: ошибка получения платежа (${res.status})`);
  }
  return (await res.json()) as YooKassaPayment;
}

export interface YooKassaWebhookEvent {
  event: "payment.succeeded" | "payment.canceled" | string;
  object: {
    id: string;
    status: string;
    metadata?: { orderId?: string; orderNumber?: string };
  };
}
