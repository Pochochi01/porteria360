import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { api, errMsg } from '../lib/api';
import { fmtDate } from '../lib/format';
import { Modal } from './crud';
import { Alert } from './ui';

const GeoMap = lazy(() => import('./GeoMap'));

/** Estado de validación de un escaneo: etiqueta, ícono y tono (compartido por el recorrido y el informe). */
const SCAN_STATUS = {
  valid: { label: 'Controlado correctamente', icon: '✔', tone: 'ok', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' },
  out_of_range: { label: 'Fuera de radio', icon: '⚠', tone: 'bad', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' },
  gps_inaccurate: { label: 'GPS impreciso', icon: '⚠', tone: 'warn', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  gps_disabled: { label: 'GPS desactivado', icon: '⚠', tone: 'warn', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  gps_denied: { label: 'GPS denegado', icon: '⚠', tone: 'bad', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' },
  location_error: { label: 'Error de ubicación', icon: '⚠', tone: 'warn', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  point_unlocated: { label: 'Punto sin ubicación', icon: '⚠', tone: 'warn', cls: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
};
export const ScanBadge = ({ s }) => {
  const x = SCAN_STATUS[s] || { label: s, icon: '', cls: 'bg-slate-100' };
  return <span className={`badge whitespace-nowrap ${x.cls}`}><span aria-hidden>{x.icon} </span>{x.label}</span>;
};
const coord = (lat, lng) => (lat == null ? '—' : `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`);

/** Recorrido de una ronda: mapa con puntos (y su radio) e intentos reales del guardia, más el detalle de cada uno. */
export function RoundTrace({ roundId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [sel, setSel] = useState(null);

  useEffect(() => { api.get(`/rounds/${roundId}/scans`).then((r) => setData(r.data)).catch((e) => setError(errMsg(e))); }, [roundId]);

  const { marks, lines } = useMemo(() => {
    if (!data) { return { marks: [], lines: [] }; }
    const pts = data.points.filter((p) => p.cp_lat != null)
      .map((p) => ({ lat: Number(p.cp_lat), lng: Number(p.cp_lng), radius: p.radius_m, tone: 'point', label: `${p.name} (radio ${p.radius_m} m)` }));
    const shown = sel ? data.scans.filter((s) => s.id === sel) : data.scans;
    const sc = shown.filter((s) => s.lat != null).map((s) => ({
      lat: Number(s.lat), lng: Number(s.lng), tone: SCAN_STATUS[s.status]?.tone || 'warn',
      label: `${s.name}: ${SCAN_STATUS[s.status]?.label || s.status}${s.distance_m != null ? ` · ${Math.round(s.distance_m)} m` : ''}`,
      cp: s.cp_lat != null ? { lat: Number(s.cp_lat), lng: Number(s.cp_lng) } : null,
    }));
    return { marks: [...pts, ...sc], lines: sc.filter((s) => s.cp && s.tone !== 'ok').map((s) => [s.cp, s]) };
  }, [data, sel]);

  return (
    <Modal title={data ? `Recorrido de ${data.guard_name}` : 'Recorrido'} onClose={onClose} wide>
      <Alert msg={error} />
      {!data ? <p className="py-6 text-center text-sm text-slate-500">{error ? '' : 'Cargando…'}</p> : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Inicio {fmtDate(data.started_at)}{data.finished_at && <> · Fin {fmtDate(data.finished_at)}</>} · {data.points.filter((p) => p.scanned_at).length}/{data.points.length} puntos
          </p>
          <Suspense fallback={<div className="grid h-72 place-items-center rounded-xl bg-slate-100 text-sm text-slate-500 dark:bg-slate-800">Cargando mapa…</div>}>
            <GeoMap marks={marks} lines={lines} label="Mapa del recorrido: puntos de control e intentos de escaneo" />
          </Suspense>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span><span className="text-blue-600">●</span> Punto de control y radio</span>
            <span><span className="text-emerald-600">●</span> Escaneo válido</span>
            <span><span className="text-red-600">●</span> / <span className="text-amber-600">●</span> Intento rechazado (línea hasta el punto)</span>
          </p>
          {sel && <button type="button" className="min-h-11 text-sm text-brand-700 underline dark:text-brand-300" onClick={() => setSel(null)}>Ver todos los intentos en el mapa</button>}

          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Fecha y hora</th><th>Punto</th><th>Resultado</th><th>Distancia</th><th>Precisión</th><th>Ubicación real</th><th>Ubicación del punto</th><th>Dispositivo</th></tr></thead>
              <tbody>
                {data.scans.map((s) => (
                  <tr key={s.id} className={`cursor-pointer ${sel === s.id ? 'bg-brand-50 dark:bg-brand-500/10' : ''}`} onClick={() => setSel(s.id === sel ? null : s.id)}>
                    <td className="whitespace-nowrap">{fmtDate(s.scanned_at)}</td>
                    <td>{s.name}</td>
                    <td><ScanBadge s={s.status} /></td>
                    <td className="tabular-nums">{s.distance_m != null ? `${Math.round(s.distance_m)} m` : '—'}{s.cp_radius_m ? <span className="text-xs text-slate-400"> / {s.cp_radius_m}</span> : null}</td>
                    <td className="tabular-nums">{s.accuracy_m != null ? `±${Math.round(s.accuracy_m)} m` : '—'}</td>
                    <td className="whitespace-nowrap font-mono text-xs">{coord(s.lat, s.lng)}</td>
                    <td className="whitespace-nowrap font-mono text-xs">{coord(s.cp_lat, s.cp_lng)}</td>
                    <td className="whitespace-nowrap text-xs">{[s.device, s.browser].filter(Boolean).join(' · ')}{s.ip && <span className="block text-slate-400">{s.ip}</span>}</td>
                  </tr>
                ))}
                {!data.scans.length && <tr><td colSpan={8} className="py-4 text-center text-slate-500">Sin escaneos en esta ronda.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
