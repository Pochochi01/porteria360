import { lazy, Suspense, useMemo, useState } from 'react';
import { api, errMsg } from '../lib/api';
import { GEO_ERRORS } from '../lib/geo';
import { useGeolocation } from '../hooks/useGeolocation';
import { Modal } from './crud';
import { Alert, Field } from './ui';

const GeoMap = lazy(() => import('./GeoMap'));
const DEFAULT_RADIUS = 30;
const num = (v) => (v === '' || v == null ? null : Number(v));

/**
 * Alta y edición de un punto de control con su ubicación (mapa, GPS del dispositivo o coordenadas a mano).
 * @param {{ row?: any, onSaved: () => void, onClose: () => void }} props  row: punto a editar (sin row = alta)
 */
export function CheckpointForm({ row, onSaved, onClose }) {
  const [v, setV] = useState(() => ({
    name: row?.name ?? '', tag_code: row?.tag_code ?? '', sort_order: row?.sort_order ?? 0, active: row ? !!Number(row.active) : true,
    lat: row?.lat ?? '', lng: row?.lng ?? '', radius_m: row?.radius_m ?? DEFAULT_RADIUS,
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const geo = useGeolocation({ maxAccuracy: 15, timeout: 25000 });
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setPos = (p) => setV((s) => ({ ...s, lat: String(p.lat), lng: String(p.lng) }));

  const lat = num(v.lat);
  const lng = num(v.lng);
  const located = Number.isFinite(lat) && Number.isFinite(lng) && lat !== null && lng !== null;
  const marks = useMemo(() => (located ? [{ lat, lng, radius: Number(v.radius_m) || DEFAULT_RADIUS, tone: 'point', label: v.name || 'Punto' }] : []),
    [located, lat, lng, v.radius_m, v.name]);

  const useHere = async () => {
    const r = await geo.acquire();
    if (r.fix) { setPos({ lat: Number(r.fix.lat.toFixed(7)), lng: Number(r.fix.lng.toFixed(7)) }); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if ((v.lat === '') !== (v.lng === '')) { setError('Cargue latitud y longitud juntas'); return; }
    const body = {
      name: v.name.trim(), tag_code: v.tag_code.trim(), sort_order: Number(v.sort_order) || 0,
      lat: located ? lat : null, lng: located ? lng : null, radius_m: Number(v.radius_m),
    };
    setBusy(true);
    setError('');
    try {
      if (row) {
        // Solo lo que cambió (el PUT es parcial y queda auditado campo por campo)
        const full = { ...body, active: v.active };
        const changed = Object.fromEntries(Object.entries(full).filter(([k, x]) => String(x ?? '') !== String(row[k] ?? '') && !(k === 'active' && x === !!Number(row.active))));
        if (Object.keys(changed).length) { await api.put(`/checkpoints/${row.id}`, changed); }
      } else {
        await api.post('/checkpoints', body);
      }
      onSaved();
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={row ? 'Editar punto de control' : 'Nuevo punto de control'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-3">
        <Alert msg={error} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Nombre"><input className="input" required maxLength={80} value={v.name} onChange={set('name')} placeholder="Portón Norte" /></Field>
          <Field label="Código del tag NFC/QR"><input className="input font-mono" required minLength={4} maxLength={64} value={v.tag_code} onChange={set('tag_code')} /></Field>
          <Field label="Orden"><input className="input" type="number" value={v.sort_order} onChange={set('sort_order')} /></Field>
        </div>

        <fieldset className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <legend className="px-1 text-sm font-semibold">Ubicación del punto</legend>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            El guardia solo podrá marcar este punto estando dentro del radio. Tocá el mapa, usá tu ubicación actual parado en el punto, o escribí las coordenadas.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Latitud"><input className="input font-mono" type="number" step="any" min={-90} max={90} inputMode="decimal" value={v.lat} onChange={set('lat')} placeholder="-26.8245000" /></Field>
            <Field label="Longitud"><input className="input font-mono" type="number" step="any" min={-180} max={180} inputMode="decimal" value={v.lng} onChange={set('lng')} placeholder="-65.2222900" /></Field>
            <Field label="Radio permitido (m)"><input className="input" type="number" required min={5} max={1000} value={v.radius_m} onChange={set('radius_m')} /></Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary" onClick={useHere} disabled={geo.state === 'locating'}>
              {geo.state === 'locating' ? `Obteniendo ubicación…${geo.fix ? ` ±${Math.round(geo.fix.accuracy)} m` : ''}` : 'Usar mi ubicación actual'}
            </button>
            {located && <button type="button" className="min-h-11 text-sm text-red-700 underline dark:text-red-300" onClick={() => setV((s) => ({ ...s, lat: '', lng: '' }))}>Quitar ubicación</button>}
            {geo.state === 'ready' && geo.fix && <span className="text-xs text-slate-500">Precisión de la lectura: ±{Math.round(geo.fix.accuracy)} m</span>}
          </div>
          {geo.state === 'error' && <Alert msg={GEO_ERRORS[geo.error]} />}
          <Suspense fallback={<div className="grid h-72 place-items-center rounded-xl bg-slate-100 text-sm text-slate-500 dark:bg-slate-800">Cargando mapa…</div>}>
            <GeoMap marks={marks} onPick={setPos} label="Mapa: tocá para ubicar el punto de control" />
          </Suspense>
          {!located && <p className="text-xs font-medium text-amber-700 dark:text-amber-300">Sin ubicación el punto no se podrá marcar en las rondas.</p>}
        </fieldset>

        {row && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.active} onChange={set('active')} /> Activo</label>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </Modal>
  );
}
