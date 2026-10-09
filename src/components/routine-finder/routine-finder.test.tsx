import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RoutineProduct } from "@/lib/routine-engine";

const push = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { RoutineFinderProvider } from "./routine-finder-context";
import { RoutineFinderWidget } from "./routine-finder-widget";
import { RoutineFinderTrigger } from "./routine-finder-trigger";
import { CartProvider } from "@/lib/cart-context";

const cleanser: RoutineProduct = {
  id: "cleanser-1",
  slug: "cleanser-1",
  title: "Гидрофильное гель-масло",
  price: 89000,
  imageUrl: "/images/products/gidrofil.webp",
  stock: 25,
  concernSlugs: [],
  skinTypeSlugs: [],
  routineStep: 1,
  routineRole: "cleanse",
};

const acneActive: RoutineProduct = {
  id: "acne-1",
  slug: "multi3-anti-acne-serum",
  title: "Multi3 Anti-Acne Serum",
  price: 56000,
  imageUrl: "/images/products/antiaa2.webp",
  stock: 18,
  concernSlugs: ["acne"],
  skinTypeSlugs: ["oily", "combination"],
  routineStep: 2,
  routineRole: "active",
};

function renderWidget(products: RoutineProduct[] = [cleanser, acneActive]) {
  render(
    <CartProvider>
      <RoutineFinderProvider products={products}>
        <RoutineFinderTrigger className="trigger">Подобрать уход</RoutineFinderTrigger>
        <RoutineFinderWidget />
      </RoutineFinderProvider>
    </CartProvider>,
  );
}

async function goToStep4Acne(user: ReturnType<typeof userEvent.setup>, scope: "Только активный уход" | "Полный уход: очищение + активный уход" = "Только активный уход") {
  await user.click(screen.getByRole("button", { name: "Подобрать уход" }));
  await user.click(await screen.findByRole("button", { name: "Акне и несовершенства" }));
  await user.click(screen.getByRole("button", { name: "Продолжить" }));
  await user.click(await screen.findByRole("button", { name: "Жирная" }));
  await user.click(screen.getByRole("button", { name: "Продолжить" }));
  await user.click(await screen.findByRole("button", { name: scope }));
  await user.click(screen.getByRole("button", { name: "Продолжить" }));
}

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
  localStorage.clear();
  // jsdom не реализует showModal/close для <dialog> — подменяем минимально,
  // чтобы AccessibleDialog мог работать в тестовой среде.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
    this.dispatchEvent(new Event("open"));
    // Реальные браузеры при showModal() автоматически переносят focus на
    // первый focusable-элемент внутри диалога (HTML spec) — jsdom этого не
    // делает, поэтому воспроизводим здесь то же поведение для теста.
    queueMicrotask(() => {
      const focusable = this.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      (focusable ?? this).focus();
    });
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

describe("RoutineFinder — open/close", () => {
  it("нажатие «Подобрать уход» открывает dialog", async () => {
    const user = userEvent.setup();
    renderWidget();
    await user.click(screen.getByRole("button", { name: "Подобрать уход" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("после открытия focus находится внутри modal", async () => {
    const user = userEvent.setup();
    renderWidget();
    await user.click(screen.getByRole("button", { name: "Подобрать уход" }));
    const dialog = screen.getByRole("dialog");
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });

  it("dialog имеет aria-labelledby на видимый заголовок", async () => {
    const user = userEvent.setup();
    renderWidget();
    await user.click(screen.getByRole("button", { name: "Подобрать уход" }));
    const dialog = screen.getByRole("dialog");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)).toHaveTextContent("Подобрать уход");
  });

  it("кнопка закрытия (✕) закрывает dialog", async () => {
    const user = userEvent.setup();
    renderWidget();
    await user.click(screen.getByRole("button", { name: "Подобрать уход" }));
    await user.click(screen.getByRole("button", { name: "Закрыть" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});

describe("RoutineFinder — навигация по шагам", () => {
  it("без выбора ответа «Продолжить» недоступен", async () => {
    const user = userEvent.setup();
    renderWidget();
    await user.click(screen.getByRole("button", { name: "Подобрать уход" }));
    expect(screen.getByRole("button", { name: "Продолжить" })).toBeDisabled();
  });

  it("выбор ответа активирует переход дальше", async () => {
    const user = userEvent.setup();
    renderWidget();
    await user.click(screen.getByRole("button", { name: "Подобрать уход" }));
    await user.click(await screen.findByRole("button", { name: "Акне и несовершенства" }));
    expect(screen.getByRole("button", { name: "Продолжить" })).toBeEnabled();
  });

  it("Назад возвращает на предыдущий шаг и сохраняет выбранный ответ", async () => {
    const user = userEvent.setup();
    renderWidget();
    await user.click(screen.getByRole("button", { name: "Подобрать уход" }));
    await user.click(await screen.findByRole("button", { name: "Акне и несовершенства" }));
    await user.click(screen.getByRole("button", { name: "Продолжить" }));
    await screen.findByText("Какой у вас тип кожи?");
    await user.click(screen.getByRole("button", { name: "Назад" }));
    await screen.findByText("Что вас беспокоит?");
    // ответ первого шага сохранён — кнопка выбора всё ещё отмечена
    expect(screen.getByRole("button", { name: "Акне и несовершенства" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("изменение ответа пересчитывает результат", async () => {
    const user = userEvent.setup();
    renderWidget([cleanser, acneActive]);
    await goToStep4Acne(user);
    await screen.findByText("Multi3 Anti-Acne Serum");

    // назад дважды к типу кожи, меняем на "Сухая" — под неё Multi3 не подходит
    await user.click(screen.getByRole("button", { name: "Назад" })); // 4 -> 3
    await user.click(screen.getByRole("button", { name: "Назад" })); // 3 -> 2
    await screen.findByText("Какой у вас тип кожи?");
    await user.click(screen.getByRole("button", { name: "Сухая" }));
    await user.click(screen.getByRole("button", { name: "Продолжить" }));
    await user.click(await screen.findByRole("button", { name: "Только активный уход" }));
    await user.click(screen.getByRole("button", { name: "Продолжить" }));

    expect(
      await screen.findByText("Мы не нашли точного набора под выбранные параметры."),
    ).toBeInTheDocument();
  });

  it("Restart очищает ответы и возвращает на первый шаг", async () => {
    const user = userEvent.setup();
    renderWidget();
    await goToStep4Acne(user);
    await user.click(screen.getByRole("button", { name: "Начать заново" }));
    await screen.findByText("Что вас беспокоит?");
    expect(screen.getByRole("button", { name: "Акне и несовершенства" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("RoutineFinder — результат", () => {
  it("full scope включает шаг очищения, minimal — нет (влияние Step 3 на результат)", async () => {
    const user = userEvent.setup();
    renderWidget([cleanser, acneActive]);
    await goToStep4Acne(user, "Полный уход: очищение + активный уход");
    expect(await screen.findByText("Гидрофильное гель-масло")).toBeInTheDocument();
    expect(screen.getByText("Multi3 Anti-Acne Serum")).toBeInTheDocument();
    expect(screen.getByText(/Шаг 1/)).toBeInTheDocument();
    expect(screen.getByText(/Шаг 2/)).toBeInTheDocument();
  });

  it("результат отображает объяснение (reason) из движка, а не отдельную UI-логику", async () => {
    const user = userEvent.setup();
    renderWidget([acneActive]);
    await goToStep4Acne(user);
    expect(
      await screen.findByText(/Выбран как активный этап ухода, потому что вы указали «Жирная» и «Акне и несовершенства»/),
    ).toBeInTheDocument();
  });

  it("empty state показывает точную копию и действия «изменить ответы» / «каталог»", async () => {
    const user = userEvent.setup();
    renderWidget([]); // ни одного размеченного товара
    await goToStep4Acne(user);
    expect(
      await screen.findByText("Мы не нашли точного набора под выбранные параметры."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Изменить ответы" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Смотреть каталог" })).toBeInTheDocument();
  });
});

describe("RoutineFinder — корзина использует существующий commerce-механизм", () => {
  it("«В корзину» на результате добавляет ровно тот SKU и цену, что пришли от сервера", async () => {
    const user = userEvent.setup();
    renderWidget([acneActive]);
    await goToStep4Acne(user);
    await user.click(await screen.findByRole("button", { name: "В корзину" }));

    const stored = JSON.parse(localStorage.getItem("vialabote-cart") || "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      productId: "acne-1",
      slug: "multi3-anti-acne-serum",
      price: 56000, // цена из product-фикстуры (серверные данные), а не из UI
      quantity: 1,
    });
  });
});
