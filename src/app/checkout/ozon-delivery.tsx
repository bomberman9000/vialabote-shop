// Клиентский компонент без своей "use client": импортируется только из checkout/page.tsx (уже клиентского),
// поэтому onChange можно передавать функцией.
import { useEffect, useState } from "react";
import { formatPrice } from "@/lib/money";
import { deliveryReasonText, formatDeliveryDate } from "@/lib/delivery/format";

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
 * Выбор пункта выдачи Ozon и расчёт. Пункты ищутся рядом с покупателем (геолокация браузера);
 * цена и МАКСИМАЛЬНЫЙ срок показываются до оплаты. Сумму при оформлении сервер считает заново.
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

  async function findNearby() {
    setMessage(null);
    if (!navigator.geolocation) {
      setMessage("Браузер не умеет определять местоположение");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const near = await fetch(`/api/delivery/ozon/points?lat=${pos.coords.latitude}&long=${pos.coords.longitude}&limit=10`).then((r) => r.json());
          const ids: string[] = (near.points ?? []).map((p: { id: string }) => p.id);
          if (ids.length === 0) {
            setMessage("Рядом не нашлось пунктов Ozon");
            return;
          }
          const dist = new Map<string, number>((near.points ?? []).map((p: { id: string; distanceKm: number }) => [p.id, p.distanceKm]));
          const cards = await fetch(`/api/delivery/ozon/points/info?ids=${ids.join(",")}`).then((r) => r.json());
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
      },
      () => {
        setBusy(false);
        setMessage("Разрешите доступ к местоположению, чтобы найти ближайшие пункты Ozon");
      },
    );
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
      {points.length > 0 ? (
        <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
          {points.map((p) => (
            <li key={p.id}>
              <label className="flex items-start gap-2">
                <input type="radio" name="ozon-point" className="mt-1" checked={pointId === p.id} onChange={() => setPointId(p.id)} />
                <span>
                  <span className="font-medium text-brand-800">{p.name ?? "Пункт выдачи Ozon"}</span>
                  {p.distanceKm !== undefined ? <span className="text-brand-500"> · {p.distanceKm} км</span> : null}
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
