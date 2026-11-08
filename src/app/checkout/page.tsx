import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkoutProfileSelect, toCheckoutProfile } from "@/lib/checkout-profile";
import { CheckoutForm } from "./checkout-form";

/** Оформление заказа. Зарегистрированному данные подставляются из профиля — уже в первом HTML, без мигания пустых полей. */
export default async function CheckoutPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const user = userId ? await prisma.user.findUnique({ where: { id: userId }, select: checkoutProfileSelect }) : null;
  return <CheckoutForm profile={user ? toCheckoutProfile(user) : null} />;
}
