import { useCallback, useState } from 'react';
import { useSocketEvent } from '../lib/auth';
import { PageTitle, Status } from '../components/ui';
import { fmtDate } from '../lib/format';
import { useFetch } from '../hooks/useFetch';
import { useCrud } from '../hooks/useCrud';
import { CheckpointForm } from '../components/CheckpointForm';
import { RoundTrace, ScanBadge } from '../components/RoundTrace';

const REPORT_FILTERS = [['invalid', 'Todos los rechazados'], ['out_of_range', 'Fuera de radio'], ['gps_inaccurate', 'GPS impreciso'],
  ['gps_denied', 'GPS denegado'], ['gps_disabled', 'GPS desactivado'], ['all', 'Todos (incluye válidos)']];

export default function RoundsBoard() {
  const rounds = useFetch('/rounds');
  const cps = useFetch('/checkpoints');
  const [alerts, setAlerts] = useState([]);
  const [cpForm, setCpForm] = useState(null); // { row? } alta o edición de punto
  const [trace, setTrace] = useState(null); // id de ronda para ver el recorrido
  const [reportFilter, setReportFilter] = useState('invalid');
  const report = useFetch(`/round-scans?status=${reportFilter}&days=7`);
  const roundCrud = useCrud({
    path: '/rounds', label: 'ronda', onChange: rounds.reload,
    fields: [
      { name: 'status', label: 'Estado', type: 'select', required: true,
        options: [{ value: 'in_progress', label: 'En curso' }, { value: 'completed', label: 'Completa' }, { value: 'incomplete', label: 'Incompleta' }] },
      { name: 'expected_minutes', label: 'Duración esperada (min)', type: 'number', required: true },
    ],
  });
  // Edición con formulario propio (ubicación + mapa); useCrud aporta solo el borrado con dependencias
  const cpCrud = useCrud({ path: '/checkpoints', label: 'punto de control', onChange: cps.reload });

  useSocketEvent('round:updated', useCallback((r) =>
    rounds.setData((l) => [r, ...(l || []).filter((x) => x.id !== r.id)]), [rounds]));
  useSocketEvent('round:alert', useCallback((a) => setAlerts((l) => [a, ...l].slice(0, 20)), []));
  // Intento de marcar un punto rechazado (fuera de radio, sin GPS…): aviso en vivo y refresco del informe
  useSocketEvent('round:scan', useCallback((x) => {
    const guard = rounds.data?.find((r) => r.id === x.round_id)?.guard_name || 'Guardia';
    const what = x.status === 'out_of_range' ? `a ${x.distance_m} m del punto` : x.status === 'gps_inaccurate' ? `con GPS impreciso (±${Math.round(x.accuracy_m)} m)` : 'sin ubicación válida';
    setAlerts((l) => [{ round_id: x.round_id, at: new Date().toISOString(), guard_name: guard, message: `intentó marcar "${x.checkpoint}" ${what}`, warn: true }, ...l].slice(0, 20));
    report.reload();
  }, [rounds.data, report]));

  const inProgress = rounds.data?.filter((r) => r.status === 'in_progress') || [];
  const finished = rounds.data?.filter((r) => r.status !== 'in_progress') || [];

  return (
    <div className="space-y-4">
      <PageTitle>Tablero de rondas <span className="ml-2 text-xs font-normal text-emerald-600">● en vivo</span></PageTitle>

      {alerts.map((a) => (
        <div key={`${a.round_id}-${a.at}`} className={`rounded-lg border-l-4 p-3 text-sm ${a.warn ? 'border-amber-500 bg-amber-50 dark:bg-amber-500/10' : 'border-red-600 bg-red-50 dark:bg-red-500/10'}`}>
          <b>{a.guard_name}</b>: {a.message} <span className="text-xs text-slate-500">({new Date(a.at).toLocaleTimeString()})</span>
        </div>
      ))}

      <div className="grid gap-3 md:grid-cols-2">
        {inProgress.map((r) => {
          const done = r.points.filter((p) => p.scanned_at).length;
          return (
            <div key={r.id} className="card">
              <div className="flex justify-between"><b>{r.guard_name}</b><Status s={r.status} /></div>
              <p className="text-xs text-slate-500">Inicio {fmtDate(r.started_at)} · {r.expected_minutes} min</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {r.points.map((p) => (
                  <span key={p.id} title={p.scanned_at || 'pendiente'}
                    className={`badge ${p.scanned_at ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>{p.name}</span>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-sm">{done}/{r.points.length}
                <span className="inline-flex gap-1"><button type="button" className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800" onClick={() => setTrace(r.id)}>Ver recorrido</button>{roundCrud.actions(r)}</span></div>
            </div>
          );
        })}
        {!inProgress.length && <p className="text-sm text-slate-500">No hay rondas en curso.</p>}
      </div>

      <div className="card overflow-x-auto">
        <h2 className="mb-2 font-semibold">Últimas 24 h</h2>
        <table className="table">
          <thead><tr><th>Guardia</th><th>Inicio</th><th>Fin</th><th>Puntos</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {finished.map((r) => (
              <tr key={r.id}>
                <td>{r.guard_name}</td><td>{fmtDate(r.started_at)}</td><td>{fmtDate(r.finished_at)}</td>
                <td>{r.points.filter((p) => p.scanned_at).length}/{r.points.length}</td><td><Status s={r.status} /></td>
                <td className="text-right"><span className="inline-flex gap-1"><button type="button" className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800" onClick={() => setTrace(r.id)}>Recorrido</button>{roundCrud.actions(r)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="card">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Intentos de control (últimos 7 días)</h2>
          <label className="flex items-center gap-2 text-sm"><span className="sr-only">Filtrar intentos</span>
            <select className="input !w-auto" value={reportFilter} onChange={(e) => setReportFilter(e.target.value)}>
              {REPORT_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Fecha y hora</th><th>Guardia</th><th>Punto</th><th>Resultado</th><th>Distancia</th><th>Precisión</th><th /></tr></thead>
            <tbody>
              {report.data?.map((x) => (
                <tr key={x.id}>
                  <td className="whitespace-nowrap">{fmtDate(x.scanned_at)}</td><td>{x.guard_name}</td><td>{x.name}</td>
                  <td><ScanBadge s={x.status} /></td>
                  <td className="tabular-nums">{x.distance_m != null ? `${Math.round(x.distance_m)} m` : '—'}</td>
                  <td className="tabular-nums">{x.accuracy_m != null ? `±${Math.round(x.accuracy_m)} m` : '—'}</td>
                  <td className="text-right"><button type="button" className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800" onClick={() => setTrace(x.round_id)}>Ver en mapa</button></td>
                </tr>
              ))}
              {report.data && !report.data.length && <tr><td colSpan={7} className="py-4 text-center text-slate-500">Sin intentos con ese filtro.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Puntos de control ({cps.data?.length ?? 0})</h2>
          <button type="button" className="btn-primary" onClick={() => setCpForm({})}>Nuevo punto</button>
        </div>
        {!!cps.data?.some((c) => c.lat == null) && (
          <p role="status" className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
            Hay puntos sin ubicación: los guardias no podrán marcarlos hasta que les cargues coordenadas.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Orden</th><th>Nombre</th><th>Tag</th><th>Ubicación</th><th>Radio</th><th /></tr></thead>
            <tbody>
              {cps.data?.map((c) => (
                <tr key={c.id}><td>{c.sort_order}</td><td>{c.name}</td><td className="font-mono text-xs">{c.tag_code}</td>
                  <td className="whitespace-nowrap font-mono text-xs">{c.lat != null ? `${Number(c.lat).toFixed(6)}, ${Number(c.lng).toFixed(6)}` : <span className="font-sans text-amber-700 dark:text-amber-300">Sin ubicación</span>}</td>
                  <td>{c.radius_m} m</td>
                  <td className="text-right"><span className="inline-flex gap-1">
                    <button type="button" className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800" onClick={() => setCpForm({ row: c })}>Editar</button>
                    {cpCrud.actions(c)}</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {roundCrud.ui}
      {cpCrud.ui}
      {cpForm && <CheckpointForm row={cpForm.row} onClose={() => setCpForm(null)} onSaved={() => { setCpForm(null); cps.reload(); }} />}
      {trace && <RoundTrace roundId={trace} onClose={() => setTrace(null)} />}
    </div>
  );
}
