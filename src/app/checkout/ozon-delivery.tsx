// Клиентский компонент без своей "use client": импортируется только из checkout/checkout-form.tsx (уже клиентского),
// поэтому onChange можно передавать функцией.
import { useEffect, useRef, useState } from "react";
import { formatPrice } from "@/lib/money";
import { deliveryReasonText, formatDeliveryDate } from "@/lib/delivery/format";
import { findCity, RU_CITIES } from "@/lib/delivery/ru-cities";
import type { LatLong } from "@/lib/delivery/ozon";
import type { MapTiles } from "@/lib/delivery/map-tiles";
import { OzonMap } from "./ozon-map";

/** Центр карты, пока покупатель не выбрал ни город, ни «рядом со мной». */
const DEFAULT_CENTER: LatLong = { lat: 55.7558, long: 37.6173 };
/** Сколько пунктов показываем и считаем за раз (столько же принимает /api/delivery/ozon/quotes). */
const PAGE = 10;

export interface OzonPoint {
  id: string;
  name: string | null;
  address: string | null;
  city: string | null;
  storageDays: number | null;
  distanceKm?: number;
  lat?: number | null;
  long?: number | null;
}

export interface OzonQuote {
  priceKopecks: number;
  maxDate: string;
}

export interface OzonSelection {
  point: OzonPoint;
  quote: OzonQuote;
}

type PointQuote = ({ available: true } & OzonQuote) | { available: false; reason: string };

/**
 * Выбор пункта выдачи Ozon и расчёт. Пункты ищутся рядом с покупателем (геолокация браузера), у центра
 * выбранного города, на указанной улице этого города или на карте. У каждого пункта в списке — цена и
 * МАКСИМАЛЬНЫЙ срок, пункты, куда Ozon заказ не довезёт, помечены и не выбираются. Пункт прошлого заказа
 * выбран заранее. Сумму при оформлении сервер считает заново.
 */
export function OzonDelivery({
  items,
  onChange,
  map = null,
  initialPointId = null,
  freeDelivery = false,
}: {
  items: { productId: string; quantity: number }[];
  onChange: (s: OzonSelection | null) => void;
  /** Свой сервер плиток; без него карты нет (остальные способы поиска работают). */
  map?: MapTiles | null;
  /** Пункт прошлого заказа (профиль или этот браузер). Закрытый пункт просто не подставляется. */
  initialPointId?: string | null;
  /** сумма товаров от порога — покупатель за доставку не платит (цена Ozon в onChange та же) */
  freeDelivery?: boolean;
}) {
  const [points, setPoints] = useState<OzonPoint[]>([]);
  const [pointId, setPointId] = useState<string | null>(null);
  const [quote, setQuote] = useState<OzonQuote | null>(null);
  const [quotes, setQuotes] = useState<Record<string, PointQuote | null>>({});
  const [shown, setShown] = useState(PAGE);
  const [remembered, setRemembered] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const itemsKey = JSON.stringify(items);
  const itemsKeyRef = useRef(itemsKey);
  const requested = useRef(new Set<string>());
  // Покупатель уже ищет сам — пункт прошлого заказа, догрузившийся позже, его выбор не перебивает.
  const acted = useRef(false);

  const [city, setCity] = useState("");
  const [street, setStreet] = useState("");
  const [fromCity, setFromCity] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [center, setCenter] = useState<LatLong | null>(null);

  function showList(list: OzonPoint[]) {
    setPointId(null);
    setShown(PAGE);
    setPoints(list);
  }

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
      showList(
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
    acted.current = true;
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
      showList(found);
      if (found.length === 0) {
        setMessage(`На этой улице пунктов Ozon не нашлось — проверьте название${map ? " или выберите пункт на карте" : ""}`);
      }
    } catch {
      setMessage("Не удалось загрузить пункты выдачи, попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  function findInCity(name = city) {
    acted.current = true;
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
    acted.current = true;
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

  // Пункт прошлого заказа: свежая карточка из Ozon (закрытый пункт не подставляем) и сразу расчёт.
  useEffect(() => {
    if (!initialPointId || !/^\d{1,19}$/.test(initialPointId)) return;
    let cancelled = false;
    fetch(`/api/delivery/ozon/points/info?ids=${initialPointId}`)
      .then((r) => r.json())
      .then((res) => {
        const card: OzonPoint | undefined = (res.points ?? []).find(
          (p: OzonPoint & { enabled: boolean }) => p.id === initialPointId && p.enabled,
        );
        if (cancelled || !card || acted.current) return;
        setPoints([card]);
        setPointId(card.id);
        setRemembered(card.id);
        setCity((c) => c || card.city || "");
        if (card.lat != null && card.long != null) setCenter({ lat: card.lat, long: card.long });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [initialPointId]);

  // Цена и срок для видимых пунктов — одним запросом до PAGE штук. Ответ, пришедший после смены
  // корзины, отбрасываем; ограничение частоты (429) — просто без цен, расчёт будет при выборе.
  useEffect(() => {
    if (itemsKeyRef.current !== itemsKey) {
      itemsKeyRef.current = itemsKey;
      requested.current = new Set();
      setQuotes({});
    }
    const ids = points
      .slice(0, shown)
      .map((p) => p.id)
      .filter((id) => !requested.current.has(id))
      .slice(0, PAGE);
    if (ids.length === 0) return;
    ids.forEach((id) => requested.current.add(id));
    const key = itemsKey;
    fetch("/api/delivery/ozon/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, mapPointIds: ids }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.quotes && key === itemsKeyRef.current) setQuotes((prev) => ({ ...prev, ...d.quotes }));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, shown, itemsKey]);

  const selected = points.find((p) => p.id === pointId) ?? null;
  const known = pointId ? quotes[pointId] : undefined;

  useEffect(() => {
    const point = points.find((p) => p.id === pointId);
    if (!point) {
      setQuote(null);
      onChange(null);
      return;
    }
    // Пункт уже посчитан в списке — второй раз в Ozon не ходим (и снимаем «занято» отменённого расчёта).
    if (known) {
      setBusy(false);
      if (known.available) {
        const next = { priceKopecks: known.priceKopecks, maxDate: known.maxDate };
        setQuote(next);
        setMessage(null);
        onChange({ point, quote: next });
      } else {
        setQuote(null);
        onChange(null);
        setMessage(deliveryReasonText(known.reason));
      }
      return;
    }
    setQuote(null);
    onChange(null);
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
  }, [pointId, itemsKey, points, known]);

  const visible = points.slice(0, shown);

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
      {!map ? null : mapOpen && center ? (
        <OzonMap tiles={map} center={center} selected={selected} onPick={(id) => void pickFromMap(id)} />
      ) : (
        <button type="button" className="btn-outline self-start" onClick={openMap}>
          Выбрать на карте
        </button>
      )}
      {remembered && remembered === pointId && points.length === 1 ? (
        <p className="text-brand-600">Пункт из прошлого заказа. Другой можно найти рядом, в городе или на карте.</p>
      ) : null}
      {visible.length > 0 ? (
        <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {visible.map((p) => {
            const q = quotes[p.id];
            const off = q?.available === false;
            return (
              <li key={p.id}>
                <label className={`flex items-start gap-2 ${off ? "cursor-not-allowed opacity-60" : ""}`}>
                  <input
                    type="radio"
                    name="ozon-point"
                    className="mt-1"
                    checked={pointId === p.id}
                    disabled={off}
                    onChange={() => setPointId(p.id)}
                  />
                  <span className="min-w-0">
                    <span className="font-medium text-brand-800">{p.name ?? "Пункт выдачи Ozon"}</span>
                    {remembered === p.id ? <span className="text-brand-500"> · прошлый заказ</span> : null}
                    {p.distanceKm !== undefined ? (
                      <span className="text-brand-500">
                        {" "}
                        · {p.distanceKm} км{fromCity ? " от центра" : ""}
                      </span>
                    ) : null}
                    <br />
                    <span className="text-brand-600">{p.address}</span>
                    {q?.available ? (
                      <span className="block text-brand-800">
                        {freeDelivery ? "Бесплатно" : formatPrice(q.priceKopecks)} · получение до {formatDeliveryDate(q.maxDate)}
                      </span>
                    ) : null}
                    {q && !q.available ? <span className="block text-red-600">{deliveryReasonText(q.reason)}</span> : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
      {points.length > shown ? (
        <button type="button" className="btn-outline self-start" onClick={() => setShown((n) => n + PAGE)}>
          Показать ещё {Math.min(PAGE, points.length - shown)}
        </button>
      ) : null}
      {quote ? (
        <p className="font-medium text-brand-800">
          Доставка {freeDelivery ? "бесплатно" : formatPrice(quote.priceKopecks)}, получение не позднее {formatDeliveryDate(quote.maxDate)}
        </p>
      ) : null}
      {message ? <p className="text-red-600">{message}</p> : null}
    </div>
  );
}
