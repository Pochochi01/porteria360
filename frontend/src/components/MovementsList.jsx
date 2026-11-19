import { useCallback, useEffect, useState } from 'react';
import { api, errMsg } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useSocketEvent } from '../lib/auth';
import { Alert } from './ui';

const FILTERS = [
  { id: 'all', label: 'Todos' }, { id: 'inside', label: 'Ingresados' },
  { id: 'exited', label: 'Egresados' }, { id: 'rejected', label: 'Rechazados' },
];
// INGRESÓ verde · SALIÓ azul · RECHAZADO rojo
const STATE = {
  inside: { label: 'Ingresó', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300', at: (m) => m.entry_at },
  exited: { label: 'Salió', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300', at: (m) => m.exit_at },
  rejected: { label: 'Rechazado', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300', at: (m) => m.rejected_at },
};
const METHOD = { invitation_qr: 'Invitación QR', dni_manual: 'DNI' };
const PAGE = 5;

/**
 * Últimos movimientos de la guardia (ingresos, egresos y rechazos). Filtra y pagina en el servidor.
 * @param {{ onExit?: (m: any) => void }} props onExit: registrar el egreso de quien sigue adentro
 */
export function MovementsList({ onExit }) {
  const [filter, setFilter] = useState('all');
  const [items, setItems] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (offset = 0) => {
    try {
      const { data } = await api.get('/visits', { params: { movement: filter, limit: PAGE, offset } });
      setItems((prev) => (offset ? [...(prev || []), ...data.items] : data.items));
      setHasMore(data.hasMore);
      setError('');
    } catch (e) { setError(errMsg(e)); }
  }, [filter]);
  useEffect(() => { load(0); }, [load]);
  // Cualquier ingreso, egreso o rechazo (de este u otro puesto) refresca la primera página
  const refresh = useCallback(() => load(0), [load]);
  useSocketEvent('visit:updated', refresh);

  return (
    <section className="card" aria-labelledby="moves-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="moves-title" className="font-semibold">Últimos movimientos</h2>
        <div role="group" aria-label="Filtrar movimientos" className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
              className={`touch-target shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${filter === f.id
                ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <Alert msg={error} />
      {!items ? <p className="py-6 text-center text-sm text-slate-500">Cargando…</p>
        : !items.length ? <p className="py-6 text-center text-sm text-slate-500">Sin movimientos.</p> : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800" aria-live="polite">
            {items.map((m) => {
              const st = STATE[m.status];
              return (
                <li key={m.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium [overflow-wrap:anywhere]">{m.visitor_name}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      DNI {m.visitor_dni || '—'} · Lote {m.lot_code}{m.family ? ` · ${m.family}` : ''}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {fmtDate(st?.at(m) || m.last_movement_at)}
                      {m.entry_method && m.status !== 'rejected' ? ` · ${METHOD[m.entry_method]}` : ''}
                      {m.guard_name ? ` · ${m.guard_name}` : ''}
                      {m.reject_reason ? ` · ${m.reject_reason}` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`badge ${st?.cls || ''}`}>{st?.label || m.status}</span>
                    {m.status === 'inside' && onExit && <button type="button" className="btn-secondary !py-1" onClick={() => onExit(m)}>Salida</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      {hasMore && <button type="button" className="btn-secondary mt-2 w-full" onClick={() => load(items.length)}>Ver más</button>}
    </section>
  );
}
