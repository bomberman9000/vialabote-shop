import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OzonDelivery } from "./ozon-delivery";
import { findCity, RU_CITIES } from "@/lib/delivery/ru-cities";

const json = (body: unknown) => Promise.resolve({ json: async () => body } as Response);

function ozonApi() {
  return vi.fn((url: string) => {
    if (url.startsWith("/api/delivery/ozon/points/info")) {
      return json({ points: [{ id: "55017", enabled: true, name: "Постамат Ozon Box", address: "Самара, Красноармейская, 23", city: "Самара", storageDays: 14 }] });
    }
    if (url.startsWith("/api/delivery/ozon/points")) return json({ points: [{ id: "55017", lat: 53.19, long: 50.1, distanceKm: 0.3 }] });
    if (url.startsWith("/api/delivery/ozon/quote")) return json({ available: true, priceKopecks: 6400, maxDate: "2026-10-31T17:00:00Z" });
    return json({});
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("справочник городов", () => {
  it("находит город без учёта регистра, «ё», дефисов и «г.»; неизвестный — null", () => {
    expect(findCity("самара")?.name).toBe("Самара");
    expect(findCity("  г. Орел ")?.name).toBe("Орёл");
    expect(findCity("ростов на дону")?.name).toBe("Ростов-на-Дону");
    expect(findCity("Атлантида")).toBeNull();
    expect(findCity("")).toBeNull();
  });
  it("названия уникальны, координаты — в пределах России", () => {
    expect(new Set(RU_CITIES.map((c) => c.name)).size).toBe(RU_CITIES.length);
    for (const c of RU_CITIES) {
      expect(c.lat).toBeGreaterThan(41);
      expect(c.lat).toBeLessThan(70);
      expect(c.long > 19 || c.long < -168).toBe(true);
    }
  });
});

describe("OzonDelivery: поиск пунктов по городу", () => {
  it("Enter в поле города ищет пункты у центра города и не отправляет форму заказа; дальше расчёт", async () => {
    const fetch = ozonApi();
    vi.stubGlobal("fetch", fetch);
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const onChange = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <OzonDelivery items={[{ productId: "p1", quantity: 1 }]} onChange={onChange} />
      </form>,
    );
    await userEvent.type(screen.getByLabelText("или в городе:"), "Самара{Enter}");

    expect(onSubmit).not.toHaveBeenCalled();
    await screen.findByText("Самара, Красноармейская, 23");
    expect(fetch.mock.calls[0][0]).toBe("/api/delivery/ozon/points?lat=53.1959&long=50.1002&limit=20");
    expect(screen.getByText(/0\.3 км от центра/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio"));
    await screen.findByText(/Доставка .*64.*получение не позднее/);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ quote: { priceKopecks: 6400, maxDate: "2026-10-31T17:00:00Z" } }));
  });

  it("выбор из подсказки (не набор с клавиатуры) — сразу поиск; неизвестный город — подсказка, без запросов", async () => {
    const fetch = ozonApi();
    vi.stubGlobal("fetch", fetch);
    render(<OzonDelivery items={[{ productId: "p1", quantity: 1 }]} onChange={() => {}} />);
    const input = screen.getByLabelText("или в городе:");

    fireEvent.change(input, { target: { value: "Атлантида" } });
    await userEvent.click(screen.getByRole("button", { name: "Показать пункты" }));
    expect(screen.getByText("Выберите город из подсказок")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "Москва" } });
    await waitFor(() => expect(fetch.mock.calls[0]?.[0]).toBe("/api/delivery/ozon/points?lat=55.7558&long=37.6173&limit=20"));
  });

  it("геолокацию не дали — предлагаем выбрать город", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      geolocation: { getCurrentPosition: (_ok: unknown, fail: () => void) => fail() },
    });
    render(<OzonDelivery items={[{ productId: "p1", quantity: 1 }]} onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Найти пункты выдачи рядом со мной" }));
    expect(screen.getByText("Не удалось определить местоположение — выберите город ниже")).toBeInTheDocument();
  });
});
