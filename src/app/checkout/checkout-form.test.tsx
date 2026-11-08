import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CartProvider } from "@/lib/cart-context";
import type { CheckoutProfile } from "@/lib/checkout-profile";
import { CheckoutForm } from "./checkout-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("./ozon-map", () => ({ OzonMap: () => null }));

const json = (body: unknown, ok = true) => Promise.resolve({ ok, json: async () => body } as Response);
const CART = [{ productId: "p1", slug: "tonic", title: "Тоник", price: 55000, imageUrl: "/x.png", quantity: 2 }];
const PROFILE: CheckoutProfile = {
  lastName: "Шатрова",
  firstName: "Елена",
  middleName: "",
  email: "elena@example.com",
  phone: "+79270000001",
  ozonPointId: "1237322",
};
const POINT = { id: "1237322", enabled: true, name: "Пункт Ozon", address: "Самара, улица Свободы, 69", city: "Самара", storageDays: 14 };

function api(orderReply: unknown = { orderId: "o1", orderNumber: "V-1", payPage: "/checkout/pay/V-1" }) {
  return vi.fn((url: string, _init?: RequestInit) => {
    if (url === "/api/delivery/ozon") return json({ enabled: true, map: null });
    if (url.startsWith("/api/delivery/ozon/points/info")) return json({ points: [POINT] });
    if (url === "/api/delivery/ozon/quotes") return json({ quotes: { "1237322": { available: true, priceKopecks: 26200, maxDate: "2026-11-06T17:00:00Z" } } });
    if (url === "/api/orders") return json(orderReply);
    return json({});
  });
}

const view = (profile: CheckoutProfile | null) =>
  render(
    <CartProvider>
      <CheckoutForm profile={profile} />
    </CartProvider>,
  );

const orderBody = (fetch: ReturnType<typeof api>) =>
  JSON.parse(String((fetch.mock.calls.find((c) => c[0] === "/api/orders")![1] as RequestInit).body));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("vialabote-cart", JSON.stringify(CART));
  push.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("оформление: зарегистрированный покупатель", () => {
  it("данные из профиля — компактной карточкой, без полей; пункт прошлого заказа выбран, доставка в итоге", async () => {
    vi.stubGlobal("fetch", api());
    view(PROFILE);
    expect(await screen.findByText("Елена Ш.")).toBeInTheDocument();
    expect(screen.getByText(/\+7 \(927\) 000-00-01/)).toBeInTheDocument();
    expect(screen.getByText(/elena@example\.com/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Фамилия")).toBeNull();
    expect(screen.queryByPlaceholderText("Email")).toBeNull();

    await screen.findByText("Пункт из прошлого заказа. Другой можно найти рядом, в городе или на карте.");
    // Итог с доставкой: 1 100 ₽ товаров + 262 ₽ — и в карточке «Ваш заказ», и в мобильной панели.
    await waitFor(() => expect(screen.getAllByText(/1\s?362/).length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText(/Доставка Ozon, получение до 6 ноября/)).toBeInTheDocument();
  });

  it("«Изменить» раскрывает поля, уже заполненные из профиля", async () => {
    vi.stubGlobal("fetch", api());
    view(PROFILE);
    await userEvent.click(await screen.findByRole("button", { name: "Изменить" }));
    expect(screen.getByPlaceholderText("Фамилия")).toHaveValue("Шатрова");
    expect(screen.getByPlaceholderText("Имя")).toHaveValue("Елена");
    expect(screen.getByPlaceholderText(/Телефон/)).toHaveValue("+7 (927) 000-00-01");
    expect(screen.getByPlaceholderText("Email")).toHaveValue("elena@example.com");
  });

  it("в профиле нет телефона — спрашиваем только его", async () => {
    vi.stubGlobal("fetch", api());
    view({ ...PROFILE, phone: "" });
    expect(await screen.findByPlaceholderText(/Телефон/)).toHaveValue("");
    expect(screen.queryByPlaceholderText("Фамилия")).toBeNull();
    expect(screen.queryByPlaceholderText("Email")).toBeNull();
  });

  it("заказ: имя один раз — оно же получатель Ozon; телефон получателя не дублируется", async () => {
    const fetch = api();
    vi.stubGlobal("fetch", fetch);
    view(PROFILE);
    await waitFor(() => expect(screen.getAllByText(/1\s?362/).length).toBeGreaterThanOrEqual(1));
    const pay = screen.getByRole("button", { name: "Оплатить онлайн" });
    expect(pay).toBeDisabled(); // оферта не отмечена
    await userEvent.click(screen.getByRole("checkbox", { name: /публичной офертой/ }));
    await userEvent.click(pay);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/checkout/pay/V-1"));
    const body = orderBody(fetch);
    expect(body).toMatchObject({
      customerName: "Елена Шатрова",
      customerNameParts: { lastName: "Шатрова", firstName: "Елена" },
      customerEmail: "elena@example.com",
      customerPhone: "+7 (927) 000-00-01",
      offerAccepted: true,
      pdnConsent: false,
      adsConsent: false,
      delivery: { provider: "OZON", destination: { type: "PVZ", mapPointId: "1237322" }, recipient: { lastName: "Шатрова", firstName: "Елена" } },
    });
    expect(body.delivery.recipient.phone).toBeUndefined();
    expect(localStorage.getItem("vialabote-ozon-point")).toBe("1237322");
  });

  it("«Получатель — другой человек»: его ФИО и телефон уходят получателем Ozon, покупатель остаётся заказчиком", async () => {
    const fetch = api();
    vi.stubGlobal("fetch", fetch);
    view(PROFILE);
    await waitFor(() => expect(screen.getAllByText(/1\s?362/).length).toBeGreaterThanOrEqual(1));
    await userEvent.click(screen.getByRole("checkbox", { name: "Получатель — другой человек" }));
    expect(screen.getByText("Заказчик:")).toBeInTheDocument();
    const [last, first] = [screen.getByPlaceholderText("Фамилия"), screen.getByPlaceholderText("Имя")];
    await userEvent.type(last, "Иванова");
    await userEvent.type(first, "Анна");
    await userEvent.type(screen.getByPlaceholderText(/Телефон/), "89991234567");
    expect(screen.getByPlaceholderText(/Телефон/)).toHaveValue("+7 (999) 123-45-67");
    await userEvent.click(screen.getByRole("checkbox", { name: /публичной офертой/ }));
    await userEvent.click(screen.getByRole("button", { name: "Оплатить онлайн" }));

    await waitFor(() => expect(push).toHaveBeenCalled());
    const body = orderBody(fetch);
    expect(body.customerName).toBe("Елена Шатрова");
    expect(body.delivery.recipient).toEqual({ lastName: "Иванова", firstName: "Анна", phone: "+7 (999) 123-45-67" });
  });
});

describe("оформление: гость", () => {
  it("поля с автозаполнением браузера; маска телефона; ошибки при вводе; согласия не отмечены", async () => {
    const fetch = api();
    vi.stubGlobal("fetch", fetch);
    view(null);
    const last = await screen.findByPlaceholderText("Фамилия");
    expect(last).toHaveAttribute("autocomplete", "family-name");
    expect(screen.getByPlaceholderText("Имя")).toHaveAttribute("autocomplete", "given-name");
    expect(screen.getByPlaceholderText("Отчество (необязательно)")).toHaveAttribute("autocomplete", "additional-name");
    expect(screen.getByPlaceholderText("Email")).toHaveAttribute("autocomplete", "email");
    const phone = screen.getByPlaceholderText(/Телефон/);
    expect(phone).toHaveAttribute("autocomplete", "tel");
    expect(phone).toHaveAttribute("type", "tel");

    await userEvent.type(phone, "8846");
    expect(phone).toHaveValue("+7 (846)");
    await userEvent.type(screen.getByPlaceholderText("Email"), "anna@");
    await userEvent.click(last); // уход с полей — показываем ошибки
    expect(screen.getByText("Проверьте email")).toBeInTheDocument();
    expect(screen.getByText("Нужен мобильный номер РФ: +7 9XX XXX-XX-XX")).toBeInTheDocument();
    expect(screen.queryByText("Укажите фамилию")).toBeNull(); // поле ещё не трогали

    for (const name of [/публичной офертой/, /обработку персональных данных/, /рекламные предложения/]) {
      expect(screen.getByRole("checkbox", { name })).not.toBeChecked();
    }
    expect(screen.getByRole("link", { name: "Войдите" })).toHaveAttribute("href", "/account/login?next=/checkout");
  });

  it("без пункта и оферты заказ не отправляется; ошибки полей не дают отправить запрос", async () => {
    const fetch = api();
    vi.stubGlobal("fetch", fetch);
    view(null);
    await screen.findByPlaceholderText("Фамилия");
    expect(screen.getAllByText("Отметьте согласие с офертой").length).toBeGreaterThanOrEqual(1);
    await userEvent.click(screen.getByRole("checkbox", { name: /публичной офертой/ }));
    expect(screen.getAllByText("Выберите пункт выдачи").length).toBeGreaterThanOrEqual(1);
    expect(fetch.mock.calls.some((c) => c[0] === "/api/orders")).toBe(false);
  });
});
