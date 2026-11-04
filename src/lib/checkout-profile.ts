// Данные покупателя для формы заказа: из профиля — в форму, из оформленного заказа — обратно в профиль.
// Зарегистрированный покупатель не вводит одно и то же дважды.
import type { PrismaClient } from "@prisma/client";
import { normalizeRuPhone } from "@/lib/delivery/ozon";

export interface NameParts {
  lastName: string;
  firstName: string;
  middleName: string;
}

export interface CheckoutProfile extends NameParts {
  email: string;
  phone: string;
  /** последний пункт выдачи Ozon — выбирается заранее */
  ozonPointId: string | null;
}

export const checkoutProfileSelect = {
  name: true,
  email: true,
  phone: true,
  lastName: true,
  firstName: true,
  middleName: true,
  ozonPointId: true,
} as const;

const PATRONYMIC = /(ич|вна|чна|оглы|кызы)$/i;

/**
 * «Имя» из регистрации -> фамилия, имя, отчество. Порядок угадываем по отчеству: «Шатрова Елена Петровна»
 * и «Елена Петровна Шатрова»; два слова — «Имя Фамилия», как просила прежняя форма. Ошибку покупатель
 * поправит в «Изменить» — и после заказа в профиле останутся уже раздельные поля.
 */
export function splitFullName(full: string | null | undefined): NameParts {
  const w = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (w.length === 0) return { lastName: "", firstName: "", middleName: "" };
  if (w.length === 1) return { lastName: "", firstName: w[0], middleName: "" };
  // Сначала середина: в «Иван Петрович Бабич» на «-ич» кончается и фамилия.
  if (w.length === 3 && PATRONYMIC.test(w[1])) return { lastName: w[2], firstName: w[0], middleName: w[1] };
  if (w.length === 3 && PATRONYMIC.test(w[2])) return { lastName: w[0], firstName: w[1], middleName: w[2] };
  return { lastName: w.slice(1).join(" "), firstName: w[0], middleName: "" };
}

type ProfileRow = {
  name: string | null;
  email: string;
  phone: string | null;
  lastName: string | null;
  firstName: string | null;
  middleName: string | null;
  ozonPointId: string | null;
};

export function toCheckoutProfile(u: ProfileRow): CheckoutProfile {
  const parts = u.lastName || u.firstName ? null : splitFullName(u.name);
  return {
    lastName: u.lastName ?? parts?.lastName ?? "",
    firstName: u.firstName ?? parts?.firstName ?? "",
    middleName: u.middleName ?? parts?.middleName ?? "",
    email: u.email,
    phone: u.phone ?? "",
    ozonPointId: u.ozonPointId,
  };
}

/**
 * После оформления: раздельное имя, телефон и пункт Ozon — в профиль. Email не трогаем (это логин);
 * телефон сохраняем, только если это номер РФ, который примет и Ozon.
 */
export async function rememberCheckout(
  db: Pick<PrismaClient, "user">,
  userId: string,
  d: { name?: { lastName: string; firstName: string; middleName?: string }; phone: string; ozonPointId?: string },
) {
  const phone = normalizeRuPhone(d.phone);
  await db.user.update({
    where: { id: userId },
    data: {
      ...(d.name ? { lastName: d.name.lastName, firstName: d.name.firstName, middleName: d.name.middleName ?? null } : {}),
      ...(phone ? { phone } : {}),
      ...(d.ozonPointId ? { ozonPointId: d.ozonPointId } : {}),
    },
  });
}
