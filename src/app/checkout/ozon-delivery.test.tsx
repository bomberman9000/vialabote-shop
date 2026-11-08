import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OzonDelivery } from "./ozon-delivery";
import { findCity, RU_CITIES } from "@/lib/delivery/ru-cities";

// Настоящая карта (Leaflet + тайлы OSM) в jsdom не рисуется: вместо неё — кнопка «отметка 777».
vi.mock("./ozon-map", () => ({
  OzonMap: ({
    center,
    selected,
    onPick,
  }: {
    center: { lat: number; long: number };
    selected: { id: string; lat?: number | null; long?: number | null; address: string | null } | null;
    onPick: (id: string) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onPick("777")}>
        отметка 777 у {center.lat},{center.long}
      </button>
      <p>на карте: {selected ? `${selected.id} @ ${selected.lat},${selected.long} — ${selected.address}` : "ничего"}</p>
    </div>
  ),
}));

const TILES = { url: "/maps/{z}/{x}/{y}.png", attribution: "© OpenMapTiles © OpenStreetMap contributors", maxZoom: 18 };
const json = (body: unknown) => Promise.resolve({ ok: true, json: async () => body } as Response);

function ozonApi() {
  return vi.fn((url: string) => {
    if (url.startsWith("/api/delivery/ozon/points/search")) {
      return json({
        points: [
          { id: "901", enabled: true, name: "Пункт Ozon", address: "Самара, улица Свободы, 2", city: "Самара", storageDays: 14, distanceKm: 7.9, lat: 53.23, long: 50.18 },
        ],
      });
    }
    if (url === "/api/delivery/ozon/points/info?ids=777") {
      return json({ points: [{ id: "777", enabled: true, name: "Постамат на карте", address: "Самара, улица Гагарина, 1", city: "Самара", storageDays: 7 }] });
    }
    if (url.startsWith("/api/delivery/ozon/points/info")) {
      return json({ points: [{ id: "55017", enabled: true, name: "Постамат Ozon Box", address: "Самара, Красноармейская, 23", city: "Самара", storageDays: 14 }] });
    }
    if (url.startsWith("/api/delivery/ozon/points")) return json({ points: [{ id: "55017", lat: 53.19, long: 50.1, distanceKm: 0.3 }] });
    // Пакетный расчёт по умолчанию пустой: тогда цена считается при выборе пункта, как раньше.
    if (url === "/api/delivery/ozon/quotes") return json({ quotes: {} });
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

  it("город + улица: ищем пункты на улице (в Ozon уходит только центр города и название улицы), дальше расчёт", async () => {
    const fetch = ozonApi();
    vi.stubGlobal("fetch", fetch);
    const onChange = vi.fn();
    render(<OzonDelivery items={[{ productId: "p1", quantity: 1 }]} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("или в городе:"), "Самара");
    expect(fetch).not.toHaveBeenCalled(); // ручной ввод города сам по себе не ищет
    await userEvent.type(screen.getByLabelText("улица:"), "Свободы 2{Enter}");

    await screen.findByText("Самара, улица Свободы, 2");
    expect(fetch.mock.calls[0][0]).toBe(`/api/delivery/ozon/points/search?lat=53.1959&long=50.1002&q=${encodeURIComponent("Свободы 2")}`);
    expect(screen.getByText(/7\.9 км от центра/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio"));
    await screen.findByText(/Доставка .*64.*получение не позднее/);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ point: expect.objectContaining({ id: "901" }) }));
  });

  it("на улице пусто — подсказка про карту; карта открывается у выбранного города, отметка выбирает пункт и считает доставку", async () => {
    const fetch = vi.fn((url: string) =>
      url.startsWith("/api/delivery/ozon/points/search") ? json({ points: [] }) : ozonApi()(url),
    );
    vi.stubGlobal("fetch", fetch);
    const onChange = vi.fn();
    render(<OzonDelivery items={[{ productId: "p1", quantity: 1 }]} onChange={onChange} map={TILES} />);
    await userEvent.type(screen.getByLabelText("или в городе:"), "Самара");
    await userEvent.type(screen.getByLabelText("улица:"), "Несуществующая{Enter}");
    await screen.findByText(/пунктов Ozon не нашлось — проверьте название или выберите пункт на карте/);

    await userEvent.click(screen.getByRole("button", { name: "Выбрать на карте" }));
    await userEvent.click(screen.getByRole("button", { name: "отметка 777 у 53.1959,50.1002" }));
    await screen.findByText("Самара, улица Гагарина, 1");
    expect(screen.getByRole("radio")).toBeChecked();
    await screen.findByText(/Доставка .*64.*получение не позднее/);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ point: expect.objectContaining({ id: "777" }) }));
  });

  it("пункт, выбранный в списке, уходит на карту с координатами и адресом — карта переходит к нему и подписывает", async () => {
    vi.stubGlobal("fetch", ozonApi());
    render(<OzonDelivery items={[{ productId: "p1", quantity: 1 }]} onChange={() => {}} map={TILES} />);
    await userEvent.type(screen.getByLabelText("или в городе:"), "Самара");
    await userEvent.type(screen.getByLabelText("улица:"), "Свободы{Enter}");
    await screen.findByText("Самара, улица Свободы, 2");
    await userEvent.click(screen.getByRole("button", { name: "Выбрать на карте" }));
    expect(screen.getByText("на карте: ничего")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio"));
    expect(screen.getByText("на карте: 901 @ 53.23,50.18 — Самара, улица Свободы, 2")).toBeInTheDocument();
  });

  it("без своего сервера плиток кнопки карты нет и подсказка про карту не показывается", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => (url.startsWith("/api/delivery/ozon/points/search") ? json({ points: [] }) : ozonApi()(url))));
    render(<OzonDelivery items={[{ productId: "p1", quantity: 1 }]} onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "Выбрать на карте" })).toBeNull();
    await userEvent.type(screen.getByLabelText("или в городе:"), "Самара");
    await userEvent.type(screen.getByLabelText("улица:"), "Несуществующая{Enter}");
    await screen.findByText("На этой улице пунктов Ozon не нашлось — проверьте название");
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

describe("OzonDelivery: цена и срок у каждого пункта, прошлый пункт", () => {
  const SEARCH = [
    { id: "901", enabled: true, name: "Пункт Ozon", address: "Самара, улица Свободы, 2", city: "Самара", storageDays: 14, distanceKm: 7.9 },
    { id: "902", enabled: true, name: "Пункт Ozon", address: "Самара, улица Свободы, 69", city: "Самара", storageDays: 14, distanceKm: 8.1 },
  ];
  function api(quotes: Record<string, unknown>, extra: (url: string) => Promise<Response> | null = () => null) {
    return vi.fn((url: string, init?: RequestInit) => {
      const e = extra(url);
      if (e) return e;
      if (url.startsWith("/api/delivery/ozon/points/search")) return json({ points: SEARCH });
      if (url === "/api/delivery/ozon/quotes") {
        const ids: string[] = JSON.parse(String(init?.body)).mapPointIds;
        return json({ quotes: Object.fromEntries(ids.map((id) => [id, quotes[id] ?? null])) });
      }
      return ozonApi()(url);
    });
  }

  it("у пунктов — цена и срок одним запросом; недоступный помечен и не выбирается; выбранный не пересчитывается", async () => {
    const fetch = api({
      "901": { available: true, priceKopecks: 26200, maxDate: "2026-11-06T17:00:00Z" },
      "902": { available: false, reason: "NO_TIMESLOT" },
    });
    vi.stubGlobal("fetch", fetch);
    const onChange = vi.fn();
    render(<OzonDelivery items={[{ productId: "p1", quantity: 3 }]} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("или в городе:"), "Самара");
    await userEvent.type(screen.getByLabelText("улица:"), "Свободы{Enter}");

    await screen.findByText(/262.*получение до 6 ноября/);
    expect(screen.getByText("Ozon пока не может доставить в этот пункт — выберите другой")).toBeInTheDocument();
    const [ok, off] = screen.getAllByRole("radio");
    expect(off).toBeDisabled();
    const batch = fetch.mock.calls.filter((c) => c[0] === "/api/delivery/ozon/quotes");
    expect(batch).toHaveLength(1);
    expect(JSON.parse(String((batch[0][1] as RequestInit).body))).toEqual({ items: [{ productId: "p1", quantity: 3 }], mapPointIds: ["901", "902"] });

    await userEvent.click(ok);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ point: expect.objectContaining({ id: "901" }), quote: { priceKopecks: 26200, maxDate: "2026-11-06T17:00:00Z" } }),
    );
    expect(fetch.mock.calls.some((c) => c[0] === "/api/delivery/ozon/quote")).toBe(false);
  });

  it("пакетный расчёт не удался (429) — пункты без цен, расчёт при выборе как раньше", async () => {
    const fetch = api({}, (url) => (url === "/api/delivery/ozon/quotes" ? Promise.resolve({ ok: false, json: async () => ({}) } as Response) : null));
    vi.stubGlobal("fetch", fetch);
    const onChange = vi.fn();
    render(<OzonDelivery items={[{ productId: "p1", quantity: 1 }]} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("или в городе:"), "Самара");
    await userEvent.type(screen.getByLabelText("улица:"), "Свободы{Enter}");
    await screen.findByText("Самара, улица Свободы, 69");
    await userEvent.click(screen.getAllByRole("radio")[1]);
    await screen.findByText(/Доставка .*64.*получение не позднее/);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ point: expect.objectContaining({ id: "902" }) }));
  });

  it("пункт прошлого заказа выбран сразу: город подставлен, доставка посчитана", async () => {
    const fetch = api({ "55017": { available: true, priceKopecks: 9400, maxDate: "2026-11-04T17:00:00Z" } });
    vi.stubGlobal("fetch", fetch);
    const onChange = vi.fn();
    render(<OzonDelivery items={[{ productId: "p1", quantity: 1 }]} onChange={onChange} initialPointId="55017" />);
    await screen.findByText("Пункт из прошлого заказа. Другой можно найти рядом, в городе или на карте.");
    expect(screen.getByRole("radio")).toBeChecked();
    expect(screen.getByLabelText("или в городе:")).toHaveValue("Самара");
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ point: expect.objectContaining({ id: "55017" }), quote: { priceKopecks: 9400, maxDate: "2026-11-04T17:00:00Z" } })),
    );
    expect(fetch.mock.calls[0][0]).toBe("/api/delivery/ozon/points/info?ids=55017");
  });

  it("закрытый пункт прошлого заказа не подставляется", async () => {
    vi.stubGlobal("fetch", api({}, (url) => (url.startsWith("/api/delivery/ozon/points/info") ? json({ points: [{ id: "55017", enabled: false }] }) : null)));
    render(<OzonDelivery items={[{ productId: "p1", quantity: 1 }]} onChange={() => {}} initialPointId="55017" />);
    await waitFor(() => expect(screen.queryByRole("radio")).toBeNull());
    expect(screen.queryByText(/прошлого заказа/)).toBeNull();
  });

  it("больше 10 пунктов: сначала 10 и их расчёт, «Показать ещё» — следующие с отдельным расчётом", async () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ id: String(1000 + i), enabled: true, name: `Пункт ${i}`, address: `Самара, адрес ${i}`, city: "Самара", storageDays: 14, distanceKm: i }));
    const fetch = api({}, (url) => (url.startsWith("/api/delivery/ozon/points/search") ? json({ points: many }) : null));
    vi.stubGlobal("fetch", fetch);
    render(<OzonDelivery items={[{ productId: "p1", quantity: 1 }]} onChange={() => {}} />);
    await userEvent.type(screen.getByLabelText("или в городе:"), "Самара");
    await userEvent.type(screen.getByLabelText("улица:"), "адрес{Enter}");
    await screen.findByText("Самара, адрес 9");
    expect(screen.queryByText("Самара, адрес 10")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Показать ещё 3" }));
    await screen.findByText("Самара, адрес 12");
    const batches = fetch.mock.calls.filter((c) => c[0] === "/api/delivery/ozon/quotes").map((c) => JSON.parse(String((c[1] as RequestInit).body)).mapPointIds);
    expect(batches).toEqual([many.slice(0, 10).map((p) => p.id), ["1010", "1011", "1012"]]);
  });
});
