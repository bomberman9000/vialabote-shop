import { randomUUID } from "crypto";

const YOOKASSA_API = "https://api.yookassa.ru/v3";

function authHeader(): string {
  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY;
  if (!shopId || !secretKey) {
    throw new Error("YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY не заданы в .env");
  }
  return "Basic " + Buffer.from(`${shopId}:${secretKey}`).toString("base64");
}

export interface CreatePaymentParams {
  orderId: string;
  orderNumber: string;
  amountRub: number; // рубли, с копейками
  returnUrl: string;
  description: string;
}

export interface YooKassaPayment {
  id: string;
  status: string;
  confirmation?: { confirmation_url?: string };
}

/**
 * Создаёт платёж в ЮKassa. Требует настроенный магазин (shopId/secretKey) —
 * см. README.md, раздел "Онлайн-оплата".
 */
export async function createPayment(params: CreatePaymentParams): Promise<YooKassaPayment> {
  const res = await fetch(`${YOOKASSA_API}/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(),
      "Idempotence-Key": randomUUID(),
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
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ЮKassa: ошибка создания платежа (${res.status}): ${text}`);
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
