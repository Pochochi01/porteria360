import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * @typedef {{ lat: number, lng: number, label?: string, tone?: 'ok'|'warn'|'bad'|'point'|'me', radius?: number|null }} MapMark
 *   radius: círculo del radio permitido (puntos de control)
 */
const COLORS = { ok: '#059669', warn: '#d97706', bad: '#dc2626', point: '#2563eb', me: '#7c3aed' };

/**
 * Mapa OpenStreetMap. Se carga con React.lazy: Leaflet solo baja cuando alguien abre un mapa.
 * @param {{ marks: MapMark[], lines?: Array<[MapMark, MapMark]>, onPick?: (p: { lat: number, lng: number }) => void,
 *           height?: string, label: string }} props  onPick: modo selector (tocar el mapa elige la ubicación)
 */
export default function GeoMap({ marks, lines = [], onPick, height = '18rem', label }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    const m = L.map(el.current, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    m.setView([-34.6, -58.45], 4); // hasta que haya marcas
    m.on('click', (e) => pickRef.current?.({ lat: Number(e.latlng.lat.toFixed(7)), lng: Number(e.latlng.lng.toFixed(7)) }));
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    // El contenedor puede medir 0 al montarse dentro de un modal: recalcular cuando cambie de tamaño
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); };
  }, []);

  useEffect(() => {
    const g = layer.current;
    g.clearLayers();
    const pts = [];
    for (const [a, b] of lines) {
      L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: COLORS[b.tone] || '#64748b', weight: 2, dashArray: '4 6' }).addTo(g);
    }
    for (const k of marks) {
      if (!Number.isFinite(k.lat) || !Number.isFinite(k.lng)) { continue; }
      const color = COLORS[k.tone] || COLORS.point;
      if (k.radius) {
        L.circle([k.lat, k.lng], { radius: k.radius, color, weight: 1, fillOpacity: 0.12 }).addTo(g);
      }
      const dot = L.circleMarker([k.lat, k.lng], { radius: k.tone === 'point' ? 7 : 6, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(g);
      if (k.label) { dot.bindTooltip(k.label); }
      pts.push([k.lat, k.lng]);
      if (k.radius) {
        const b = L.latLng(k.lat, k.lng).toBounds(k.radius * 2);
        pts.push([b.getNorth(), b.getEast()], [b.getSouth(), b.getWest()]);
      }
    }
    if (pts.length) { map.current.fitBounds(pts, { padding: [24, 24], maxZoom: 18 }); }
  }, [marks, lines]);

  return <div ref={el} role="application" aria-label={label} className="z-0 w-full overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700" style={{ height }} />;
}
