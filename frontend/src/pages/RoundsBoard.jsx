import { useCallback, useState } from 'react';
import { api, errMsg } from '../lib/api';
import { useSocketEvent } from '../lib/auth';
import { Alert, Field, PageTitle, Status } from '../components/ui';
import { fmtDate } from '../lib/format';
import { useFetch } from '../hooks/useFetch';
import { useForm } from '../hooks/useForm';
import { useCrud } from '../hooks/useCrud';

export default function RoundsBoard() {
  const rounds = useFetch('/rounds');
  const cps = useFetch('/checkpoints');
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState('');
  const f = useForm({ name: '', tag_code: '', sort_order: 0 });
  const roundCrud = useCrud({
    path: '/rounds', label: 'ronda', onChange: rounds.reload,
    fields: [
      { name: 'status', label: 'Estado', type: 'select', required: true,
        options: [{ value: 'in_progress', label: 'En curso' }, { value: 'completed', label: 'Completa' }, { value: 'incomplete', label: 'Incompleta' }] },
      { name: 'expected_minutes', label: 'Duración esperada (min)', type: 'number', required: true },
    ],
  });
  const cpCrud = useCrud({
    path: '/checkpoints', label: 'punto de control', onChange: cps.reload,
    fields: [
      { name: 'name', label: 'Nombre', required: true },
      { name: 'tag_code', label: 'Código del tag NFC/QR', required: true, minLength: 4 },
      { name: 'sort_order', label: 'Orden', type: 'number', required: true },
      { name: 'active', label: 'Activo', type: 'checkbox' },
    ],
  });

  useSocketEvent('round:updated', useCallback((r) =>
    rounds.setData((l) => [r, ...(l || []).filter((x) => x.id !== r.id)]), [rounds]));
  useSocketEvent('round:alert', useCallback((a) => setAlerts((l) => [a, ...l].slice(0, 20)), []));

  const addCp = async (e) => {
    e.preventDefault();
    try {
      await api.post('/checkpoints', { ...f.values, sort_order: Number(f.values.sort_order) });
      f.reset();
      cps.reload();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const inProgress = rounds.data?.filter((r) => r.status === 'in_progress') || [];
  const finished = rounds.data?.filter((r) => r.status !== 'in_progress') || [];

  return (
    <div className="space-y-4">
      <PageTitle>Tablero de rondas <span className="ml-2 text-xs font-normal text-emerald-600">● en vivo</span></PageTitle>
      <Alert msg={error} />

      {alerts.map((a) => (
        <div key={`${a.round_id}-${a.at}`} className="rounded-lg border-l-4 border-red-600 bg-red-50 p-3 text-sm">
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
              <div className="mt-2 flex items-center justify-between text-sm">{done}/{r.points.length} {roundCrud.actions(r)}</div>
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
                <td className="text-right">{roundCrud.actions(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={addCp} className="card grid gap-3 md:grid-cols-4">
        <h2 className="font-semibold md:col-span-4">Puntos de control ({cps.data?.length ?? 0})</h2>
        <Field label="Nombre"><input className="input" required {...f.bind('name')} /></Field>
        <Field label="Código del tag NFC/QR"><input className="input" required minLength={4} {...f.bind('tag_code')} /></Field>
        <Field label="Orden"><input className="input" type="number" {...f.bind('sort_order')} /></Field>
        <div className="flex items-end"><button className="btn-primary w-full">Agregar</button></div>
      </form>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Orden</th><th>Nombre</th><th>Tag</th><th /></tr></thead>
          <tbody>
            {cps.data?.map((c) => (
              <tr key={c.id}><td>{c.sort_order}</td><td>{c.name}</td><td className="font-mono text-xs">{c.tag_code}</td>
                <td className="text-right">{cpCrud.actions(c)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {roundCrud.ui}
      {cpCrud.ui}
    </div>
  );
}
