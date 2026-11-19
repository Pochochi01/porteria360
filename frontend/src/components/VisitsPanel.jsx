import { useMemo, useState } from 'react';
import { Collapsible } from './Collapsible';
import { Tabs } from './Tabs';
import { Field, Status } from './ui';
import { fmtDate } from '../lib/format';

const parse = (s) => (s ? new Date(String(s).replace(' ', 'T')) : null);
const dayOf = (s) => (s ? String(s).slice(0, 10) : '');

// Próximos: lo que todavía puede pasar o está pasando. El resto es historial.
// Autorizaciones desde la guardia (sin vigencia): cuentan como próximas durante 24 h desde que se crearon.
const DAY = 24 * 3600 * 1000;
const stillValid = (v, now) => (v.valid_until ? parse(v.valid_until) >= now : now - parse(v.created_at) < DAY);
const isUpcoming = (v, now) =>
  v.status === 'pending' || v.status === 'inside' || (v.status === 'authorized' && stillValid(v, now));

const STATUS_FILTER = [
  ['', 'Todos'], ['pending', 'Pendiente'], ['authorized', 'Autorizada'], ['inside', 'Adentro'],
  ['exited', 'Salió'], ['rejected', 'Rechazada'], ['expired', 'Vencida'], ['cancelled', 'Cancelada'],
];
const VIEWS = [{ id: 'upcoming', label: 'Próximos' }, { id: 'history', label: 'Historial' }];

/**
 * Ingresos e invitaciones, plegado por defecto para no cargar la pantalla principal.
 * @param {{ visits: any[] | null, loading?: boolean, onCancel?: (v: any) => void }} props onCancel: anular una invitación QR sin usar
 */
export function VisitsPanel({ visits, loading, onCancel }) {
  const [view, setView] = useState('upcoming');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [day, setDay] = useState('');

  const now = new Date();
  const { upcoming, history } = useMemo(() => {
    const up = [];
    const hi = [];
    for (const v of visits || []) { (isUpcoming(v, now) ? up : hi).push(v); }
    // Próximos: el más cercano primero. Historial: el más reciente primero (orden del backend)
    up.sort((a, b) => (parse(a.valid_from) || 0) - (parse(b.valid_from) || 0));
    return { upcoming: up, history: hi };
  }, [visits]); // eslint-disable-line react-hooks/exhaustive-deps -- `now` se recalcula con cada lista nueva

  const list = (view === 'upcoming' ? upcoming : history).filter((v) => {
    if (status && v.status !== status) { return false; }
    if (day && dayOf(v.valid_from || v.created_at) !== day && dayOf(v.entry_at) !== day) { return false; }
    if (q) {
      const t = q.trim().toLowerCase();
      if (![v.visitor_name, v.visitor_dni, v.vehicle_plate].some((x) => x && String(x).toLowerCase().includes(t))) { return false; }
    }
    return true;
  });
  const filtered = !!(q || status || day);

  return (
    <Collapsible title="Ingresos e invitaciones" count={upcoming.length} countLabel="ingresos próximos">
      <Tabs tabs={VIEWS.map((t) => ({ ...t, badge: t.id === 'upcoming' ? upcoming.length : 0 }))} value={view} onChange={setView} label="Ingresos" />

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Invitado"><input className="input" type="search" placeholder="Nombre, DNI o patente" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <Field label="Estado">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_FILTER.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Fecha"><input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
      </div>
      {filtered && (
        <button type="button" className="mt-2 min-h-11 text-sm text-brand-700 underline dark:text-brand-300" onClick={() => { setQ(''); setStatus(''); setDay(''); }}>
          Limpiar filtros
        </button>
      )}

      <div role="tabpanel" aria-labelledby={`tab-${view}`} aria-live="polite" className="mt-3">
        {loading && !visits ? (
          <p className="py-6 text-center text-sm text-slate-500">Cargando…</p>
        ) : list.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            {filtered ? 'No hay ingresos con esos filtros.' : view === 'upcoming' ? 'No tenés ingresos próximos.' : 'Todavía no hay historial.'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {list.map((v) => (
              <li key={v.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{v.visitor_name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {v.auth_method === 'qr' ? 'Invitación QR' : 'Llegó a la guardia'}
                    {v.vehicle_plate && <> · {v.vehicle_plate}</>}
                  </div>
                </div>
                <Status s={v.status} />
                {onCancel && v.auth_method === 'qr' && v.status === 'authorized' && !v.entry_at && (
                  <button type="button" className="btn-secondary !py-1 text-xs" onClick={() => onCancel(v)}>Cancelar</button>
                )}
                <dl className="grid w-full grid-cols-2 gap-x-3 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-4">
                  {v.valid_from && <div><dt className="inline text-slate-400">Desde </dt><dd className="inline">{fmtDate(v.valid_from)}</dd></div>}
                  {v.valid_until && <div><dt className="inline text-slate-400">Hasta </dt><dd className="inline">{fmtDate(v.valid_until)}</dd></div>}
                  {v.entry_at && <div><dt className="inline text-slate-400">Entró </dt><dd className="inline">{fmtDate(v.entry_at)}</dd></div>}
                  {v.exit_at && <div><dt className="inline text-slate-400">Salió </dt><dd className="inline">{fmtDate(v.exit_at)}</dd></div>}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Collapsible>
  );
}
