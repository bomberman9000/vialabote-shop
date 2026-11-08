// Карта пунктов Ozon: Leaflet + плитки с нашего сервера (MAP_TILE_URL, как карта ГрузПотока), сторонних карт нет.
// Открывается только кнопкой «Выбрать на карте». Отметки — из того же кеша ПВЗ (/api/delivery/ozon/points?minLat=…),
// запросов в Ozon карта не делает; адрес пункта подгружается только для выбранной отметки.
import { useEffect, useRef, useState } from "react";
import type { CircleMarker, LayerGroup, Map as LeafletMap, Popup } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { LatLong } from "@/lib/delivery/ozon";
import type { MapTiles } from "@/lib/delivery/map-tiles";

/** Мельче этого масштаба отметок слишком много — просим приблизить. */
const MIN_ZOOM = 12;
const START_ZOOM = 14;
/** Уже этого карта — телефон: масштаб пальцами, без кнопок «+/−» (они перекрывали подпись пункта). */
const NARROW = 400;
const COLOR = "#232c54"; // brand-700
const SELECTED = "#b8893a"; // gold-500

/** Выбранный пункт: карта переходит к нему, выделяет отметку и подписывает её. */
export interface MapPoint {
  id: string;
  lat?: number | null;
  long?: number | null;
  name: string | null;
  address: string | null;
}

/** Подпись выбранного пункта. Текст из Ozon — только через textContent, не HTML. */
function caption(p: MapPoint): HTMLElement {
  const el = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = p.name ?? "Пункт выдачи Ozon";
  el.append(title);
  if (p.address) el.append(document.createElement("br"), document.createTextNode(p.address));
  return el;
}

export function OzonMap({
  tiles,
  center,
  selected,
  onPick,
}: {
  tiles: MapTiles;
  center: LatLong;
  selected: MapPoint | null;
  onPick: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const popup = useRef<Popup | null>(null);
  const markers = useRef(new Map<string, CircleMarker>());
  const current = useRef(selected);
  current.current = selected;
  const pick = useRef(onPick);
  pick.current = onPick;
  const [tooFar, setTooFar] = useState(false);
  const [failed, setFailed] = useState(false);

  const style = (id: string) =>
    id === current.current?.id
      ? { radius: 10, color: "#fff", weight: 3, fillColor: SELECTED, fillOpacity: 1 }
      : { radius: 7, color: "#fff", weight: 2, fillColor: COLOR, fillOpacity: 0.9 };

  /** Показать выбранный пункт: перейти к нему, если он за краем карты, и открыть подпись. */
  function showSelected() {
    const m = map.current;
    const L = leaflet.current;
    const p = current.current;
    popup.current?.remove();
    popup.current = null;
    if (!m || !L || !p || typeof p.lat !== "number" || typeof p.long !== "number") return;
    const at: [number, number] = [p.lat, p.long];
    if (!m.getBounds().contains(at) || m.getZoom() < MIN_ZOOM) m.setView(at, Math.max(m.getZoom(), START_ZOOM));
    // На телефоне карта ~270 px, а подпись Leaflet по умолчанию до 300 px + поля — шире карты и обрезается.
    // Кнопки «+/−» лежат поверх подписей: на широкой карте держим подпись правее них.
    const narrow = m.getSize().x < NARROW;
    const width = Math.max(120, Math.min(300, m.getSize().x - (narrow ? 72 : 120)));
    popup.current = L.popup({
      offset: [0, -8],
      maxWidth: width,
      minWidth: Math.min(160, width),
      autoPanPaddingTopLeft: narrow ? [8, 8] : [52, 8],
      autoPanPaddingBottomRight: [8, 24],
      closeButton: false,
      autoClose: false,
      closeOnClick: false,
    })
      .setLatLng(at)
      .setContent(caption(p))
      .openOn(m);
  }

  useEffect(() => {
    let cancelled = false;
    let teardown = () => {};
    // Leaflet трогает window при импорте — грузим только в браузере.
    void import("leaflet").then(({ default: L }) => {
      if (cancelled || !box.current) return;
      // Без подписи-префикса Leaflet: остаётся только обязательное упоминание источника данных.
      const m = L.map(box.current, {
        attributionControl: false,
        zoomControl: box.current.clientWidth >= NARROW,
        maxZoom: tiles.maxZoom,
      }).setView(
        [center.lat, center.long],
        Math.min(START_ZOOM, tiles.maxZoom),
      );
      L.control.attribution({ prefix: false }).addTo(m);
      L.tileLayer(tiles.url, { maxZoom: tiles.maxZoom, attribution: tiles.attribution }).addTo(m);
      const layer: LayerGroup = L.layerGroup().addTo(m);
      let seq = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;

      async function refresh() {
        const n = ++seq;
        if (m.getZoom() < MIN_ZOOM) {
          layer.clearLayers();
          markers.current.clear();
          setTooFar(true);
          return;
        }
        setTooFar(false);
        const b = m.getBounds();
        const qs = new URLSearchParams({
          minLat: b.getSouth().toFixed(5),
          minLong: b.getWest().toFixed(5),
          maxLat: b.getNorth().toFixed(5),
          maxLong: b.getEast().toFixed(5),
          limit: "500",
        });
        const res = await fetch(`/api/delivery/ozon/points?${qs}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (n !== seq || cancelled) return;
        setFailed(res === null);
        layer.clearLayers();
        markers.current.clear();
        for (const p of (res?.points ?? []) as { id: string; lat: number; long: number }[]) {
          const mk = L.circleMarker([p.lat, p.long], style(p.id)).on("click", () => pick.current(p.id));
          mk.addTo(layer);
          markers.current.set(p.id, mk);
        }
      }
      // Пока карту двигают, не дёргаем сервер на каждый кадр.
      m.on("moveend", () => {
        clearTimeout(timer);
        timer = setTimeout(() => void refresh(), 250);
      });
      map.current = m;
      leaflet.current = L;
      showSelected(); // пункт могли выбрать в списке ещё до открытия карты
      void refresh();
      teardown = () => {
        clearTimeout(timer);
        m.remove();
        map.current = null;
        popup.current = null;
      };
    });
    return () => {
      cancelled = true;
      teardown();
    };
    // Карта создаётся один раз; смена центра и выбора — ниже.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (m) m.setView([center.lat, center.long], Math.max(m.getZoom(), START_ZOOM));
  }, [center.lat, center.long]);

  const prevId = useRef<string | null>(selected?.id ?? null);
  useEffect(() => {
    for (const id of [prevId.current, selected?.id ?? null]) if (id) markers.current.get(id)?.setStyle(style(id));
    prevId.current = selected?.id ?? null;
    showSelected();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.lat, selected?.long]);

  return (
    <div className="flex flex-col gap-1">
      <div ref={box} className="h-72 w-full overflow-hidden rounded border border-brand-100" />
      <p className="text-brand-500">Нажмите на точку, чтобы выбрать пункт</p>
      {tooFar ? <p className="text-brand-500">Приблизьте карту, чтобы увидеть пункты Ozon</p> : null}
      {failed ? <p className="text-red-600">Не удалось загрузить пункты на карте, подвиньте карту ещё раз</p> : null}
    </div>
  );
}
