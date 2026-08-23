export const ROLES = ["CUSTOMER", "ADMIN"] as const;

export const ORDER_STATUSES = [
  "NEW",
  "AWAITING_PAYMENT",
  "PAID",
  "PROCESSING",
  "SHIPPED",
  "COMPLETED",
  "CANCELLED",
] as const;
