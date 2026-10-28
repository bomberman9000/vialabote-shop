// Карта пунктов Ozon (Leaflet + OpenStreetMap). Открывается только кнопкой «Выбрать на карте»: до этого браузер
// покупателя к серверам OSM не обращается. Отметки — из того же кеша ПВЗ (/api/delivery/ozon/points?minLat=…),
// запросов в Ozon карта не делает; адрес пункта подгружается только для выбранной отметки.
import { useEffect, useRef, useState } from "react";
import type { CircleMarker, LayerGroup, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { LatLong } from "@/lib/delivery/ozon";

/** Мельче этого масштаба отметок слишком много — просим приблизить. */
const MIN_ZOOM = 12;
const START_ZOOM = 14;
const COLOR = "#232c54"; // brand-700
const SELECTED = "#b8893a"; // gold-500

export function OzonMap({
  center,
  selectedId,
  onPick,
}: {
  center: LatLong;
  selectedId: string | null;
  onPick: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const markers = useRef(new Map<string, CircleMarker>());
  const selected = useRef(selectedId);
  const pick = useRef(onPick);
  pick.current = onPick;
  const [tooFar, setTooFar] = useState(false);
  const [failed, setFailed] = useState(false);

  const style = (id: string) =>
    id === selected.current
      ? { radius: 10, color: "#fff", weight: 3, fillColor: SELECTED, fillOpacity: 1 }
      : { radius: 7, color: "#fff", weight: 2, fillColor: COLOR, fillOpacity: 0.9 };

  useEffect(() => {
    let cancelled = false;
    let teardown = () => {};
    // Leaflet трогает window при импорте — грузим только в браузере.
    void import("leaflet").then(({ default: L }) => {
      if (cancelled || !box.current) return;
      const m = L.map(box.current).setView([center.lat, center.long], START_ZOOM);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(m);
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
      void refresh();
      map.current = m;
      teardown = () => {
        clearTimeout(timer);
        m.remove();
        map.current = null;
      };
    });
    return () => {
      cancelled = true;
      teardown();
    };
    // Карта создаётся один раз; смена центра — ниже.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (m) m.setView([center.lat, center.long], Math.max(m.getZoom(), START_ZOOM));
  }, [center.lat, center.long]);

  useEffect(() => {
    const prev = selected.current;
    selected.current = selectedId;
    for (const id of [prev, selectedId]) if (id) markers.current.get(id)?.setStyle(style(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  return (
    <div className="flex flex-col gap-1">
      <div ref={box} className="h-72 w-full overflow-hidden rounded border border-brand-100" />
      {tooFar ? <p className="text-brand-500">Приблизьте карту, чтобы увидеть пункты Ozon</p> : null}
      {failed ? <p className="text-red-600">Не удалось загрузить пункты на карте, подвиньте карту ещё раз</p> : null}
    </div>
  );
}
