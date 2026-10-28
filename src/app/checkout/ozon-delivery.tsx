// Клиентский компонент без своей "use client": импортируется только из checkout/page.tsx (уже клиентского),
// поэтому onChange можно передавать функцией.
import { useEffect, useState } from "react";
import { formatPrice } from "@/lib/money";
import { deliveryReasonText, formatDeliveryDate } from "@/lib/delivery/format";
import { findCity, RU_CITIES } from "@/lib/delivery/ru-cities";
import type { LatLong } from "@/lib/delivery/ozon";
import { OzonMap } from "./ozon-map";

/** Центр карты, пока покупатель не выбрал ни город, ни «рядом со мной». */
const DEFAULT_CENTER: LatLong = { lat: 55.7558, long: 37.6173 };

export interface OzonPoint {
  id: string;
  name: string | null;
  address: string | null;
  city: string | null;
  storageDays: number | null;
  distanceKm?: number;
}

export interface OzonQuote {
  priceKopecks: number;
  maxDate: string;
}

export interface OzonSelection {
  point: OzonPoint;
  quote: OzonQuote;
}

/**
 * Выбор пункта выдачи Ozon и расчёт. Пункты ищутся рядом с покупателем (геолокация браузера), у центра
 * выбранного города, на указанной улице этого города или на карте. Цена и МАКСИМАЛЬНЫЙ срок показываются
 * до оплаты. Сумму при оформлении сервер считает заново.
 */
export function OzonDelivery({
  items,
  onChange,
}: {
  items: { productId: string; quantity: number }[];
  onChange: (s: OzonSelection | null) => void;
}) {
  const [points, setPoints] = useState<OzonPoint[]>([]);
  const [pointId, setPointId] = useState<string | null>(null);
  const [quote, setQuote] = useState<OzonQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const itemsKey = JSON.stringify(items);

  const [city, setCity] = useState("");
  const [street, setStreet] = useState("");
  const [fromCity, setFromCity] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [center, setCenter] = useState<LatLong | null>(null);

  async function loadPoints(lat: number, long: number, limit: number) {
    setCenter({ lat, long });
    try {
      const near = await fetch(`/api/delivery/ozon/points?lat=${lat}&long=${long}&limit=${limit}`).then((r) => r.json());
      const ids: string[] = (near.points ?? []).map((p: { id: string }) => p.id);
      if (ids.length === 0) {
        setPoints([]);
        setMessage("Рядом не нашлось пунктов Ozon");
        return;
      }
      const dist = new Map<string, number>((near.points ?? []).map((p: { id: string; distanceKm: number }) => [p.id, p.distanceKm]));
      const cards = await fetch(`/api/delivery/ozon/points/info?ids=${ids.join(",")}`).then((r) => r.json());
      setPointId(null);
      setPoints(
        (cards.points ?? [])
          .filter((c: { enabled: boolean }) => c.enabled)
          .map((c: OzonPoint) => ({ ...c, distanceKm: dist.get(c.id) }))
          .sort((a: OzonPoint, b: OzonPoint) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0)),
      );
    } catch {
      setMessage("Не удалось загрузить пункты выдачи, попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  function findNearby() {
    setMessage(null);
    if (!navigator.geolocation) {
      setMessage("Браузер не умеет определять местоположение — выберите город ниже");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFromCity(false);
        void loadPoints(pos.coords.latitude, pos.coords.longitude, 10);
      },
      () => {
        setBusy(false);
        setMessage("Не удалось определить местоположение — выберите город ниже");
      },
    );
  }

  /** Пункты на улице города: сервер ищет по адресам пунктов вокруг центра города. */
  async function loadStreet(c: LatLong, q: string) {
    setCenter(c);
    try {
      const res = await fetch(`/api/delivery/ozon/points/search?lat=${c.lat}&long=${c.long}&q=${encodeURIComponent(q)}`).then((r) =>
        r.json(),
      );
      const found: OzonPoint[] = (res.points ?? []).map((p: OzonPoint & { distanceKm: number | null }) => ({
        ...p,
        distanceKm: p.distanceKm ?? undefined,
      }));
      setPointId(null);
      setPoints(found);
      if (found.length === 0) setMessage("На этой улице пунктов Ozon не нашлось — проверьте название или выберите пункт на карте");
    } catch {
      setMessage("Не удалось загрузить пункты выдачи, попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  function findInCity(name = city) {
    const c = findCity(name);
    if (!c) {
      setMessage("Выберите город из подсказок");
      return;
    }
    setMessage(null);
    setBusy(true);
    setFromCity(true);
    if (street.trim()) void loadStreet(c, street.trim());
    else void loadPoints(c.lat, c.long, 20);
  }

  /** Отметка на карте: карточку пункта догружаем, если её ещё нет в списке, и сразу выбираем. */
  async function pickFromMap(id: string) {
    if (points.some((p) => p.id === id)) {
      setPointId(id);
      return;
    }
    setMessage(null);
    try {
      const res = await fetch(`/api/delivery/ozon/points/info?ids=${id}`).then((r) => r.json());
      const card: OzonPoint | undefined = (res.points ?? []).find((p: OzonPoint & { enabled: boolean }) => p.id === id && p.enabled);
      if (!card) {
        setMessage("Этот пункт сейчас не принимает заказы — выберите другой");
        return;
      }
      setPoints((prev) => [card, ...prev.filter((p) => p.id !== id)]);
      setPointId(id);
    } catch {
      setMessage("Не удалось загрузить пункт, попробуйте ещё раз");
    }
  }

  function openMap() {
    if (!center) {
      const c = findCity(city);
      setCenter(c ? { lat: c.lat, long: c.long } : DEFAULT_CENTER);
    }
    setMapOpen(true);
  }

  useEffect(() => {
    const point = points.find((p) => p.id === pointId);
    setQuote(null);
    onChange(null);
    if (!point) return;
    let cancelled = false;
    setBusy(true);
    setMessage(null);
    fetch("/api/delivery/ozon/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, destination: { type: "PVZ", mapPointId: point.id } }),
    })
      .then((r) => r.json())
      .then((q) => {
        if (cancelled) return;
        if (q.available) {
          const next = { priceKopecks: q.priceKopecks, maxDate: q.maxDate };
          setQuote(next);
          onChange({ point, quote: next });
        } else {
          setMessage(deliveryReasonText(q.reason));
        }
      })
      .catch(() => !cancelled && setMessage("Не удалось рассчитать доставку, попробуйте ещё раз"))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointId, itemsKey, points]);

  return (
    <div className="flex flex-col gap-3 rounded border border-brand-100 p-3 text-sm">
      <p className="text-brand-600">
        Ozon доставляет по России в пункты выдачи. Получение — по штрихкоду в приложении Ozon, нужен аккаунт Ozon
        с этим номером телефона. Заказ хранится в пункте 14 дней.
      </p>
      <button type="button" className="btn-outline self-start" onClick={findNearby} disabled={busy}>
        {busy && points.length === 0 ? "Ищем пункты…" : "Найти пункты выдачи рядом со мной"}
      </button>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="ozon-city" className="text-brand-600">
          или в городе:
        </label>
        <input
          id="ozon-city"
          className="input min-w-0 flex-1"
          list="ozon-cities"
          placeholder="Начните вводить город"
          autoComplete="address-level2"
          value={city}
          onChange={(e) => {
            setCity(e.target.value);
            // Выбор из подсказки — сразу поиск; ручной ввод — по Enter или кнопке.
            if (findCity(e.target.value) && (e.nativeEvent as InputEvent).inputType !== "insertText") findInCity(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault(); // Enter в поле города не отправляет форму заказа
            findInCity();
          }}
        />
        <datalist id="ozon-cities">
          {RU_CITIES.map((c) => (
            <option key={c.name} value={c.name} />
          ))}
        </datalist>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="ozon-street" className="text-brand-600">
          улица:
        </label>
        <input
          id="ozon-street"
          className="input min-w-0 flex-1 basis-56"
          placeholder="необязательно, например: Свободы 2"
          autoComplete="off"
          value={street}
          onChange={(e) => setStreet(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault(); // Enter в поле улицы не отправляет форму заказа
            findInCity();
          }}
        />
        <button type="button" className="btn-outline" onClick={() => findInCity()} disabled={busy || !city.trim()}>
          Показать пункты
        </button>
      </div>
      {mapOpen && center ? (
        <OzonMap center={center} selectedId={pointId} onPick={(id) => void pickFromMap(id)} />
      ) : (
        <button type="button" className="btn-outline self-start" onClick={openMap}>
          Выбрать на карте
        </button>
      )}
      {points.length > 0 ? (
        <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
          {points.map((p) => (
            <li key={p.id}>
              <label className="flex items-start gap-2">
                <input type="radio" name="ozon-point" className="mt-1" checked={pointId === p.id} onChange={() => setPointId(p.id)} />
                <span>
                  <span className="font-medium text-brand-800">{p.name ?? "Пункт выдачи Ozon"}</span>
                  {p.distanceKm !== undefined ? (
                    <span className="text-brand-500">
                      {" "}
                      · {p.distanceKm} км{fromCity ? " от центра" : ""}
                    </span>
                  ) : null}
                  <br />
                  <span className="text-brand-600">{p.address}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      {quote ? (
        <p className="font-medium text-brand-800">
          Доставка {formatPrice(quote.priceKopecks)}, получение не позднее {formatDeliveryDate(quote.maxDate)}
        </p>
      ) : null}
      {message ? <p className="text-red-600">{message}</p> : null}
    </div>
  );
}
