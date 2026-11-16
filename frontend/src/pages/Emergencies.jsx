import { useCallback, useRef, useState } from 'react';
import { api, errMsg } from '../lib/api';
import { currentPosition } from '../lib/geo';
import { useAuth, useSocketEvent } from '../lib/auth';
import { Alert, PageTitle, Status } from '../components/ui';
import { fmtDate, opts } from '../lib/format';
import { useFetch } from '../hooks/useFetch';
import { useCrud } from '../hooks/useCrud';

const TYPE = { medical: '🚑 Médica', security: '🚨 Seguridad' };


/** Botón que exige mantener presionado 2 s para evitar disparos accidentales. */
function HoldButton({ onFire, className, children }) {
  const timer = useRef();
  const [holding, setHolding] = useState(false);
  const start = () => { setHolding(true); timer.current = setTimeout(() => { setHolding(false); onFire(); }, 2000); };
  const stop = () => { setHolding(false); clearTimeout(timer.current); };
  return (
    <button onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onContextMenu={(e) => e.preventDefault()}
      className={`${className} relative select-none overflow-hidden`}>
      <span className={`absolute inset-0 origin-left bg-black/20 ${holding ? 'scale-x-100 transition-transform duration-[2000ms] ease-linear' : 'scale-x-0'}`} />
      <span className="relative">{children}</span>
    </button>
  );
}

export default function Emergencies() {
  const { is } = useAuth();
  const staff = is('guard', 'supervisor', 'admin');
  const list = useFetch('/incidents');
  const [msg, setMsg] = useState({});
  const [auditOf, setAuditOf] = useState(null);
  const crud = useCrud({
    path: '/incidents', label: 'incidente', onChange: list.reload, canEdit: staff,
    fields: [
      { name: 'type', label: 'Tipo', type: 'select', required: true, options: [{ value: 'medical', label: 'Médica' }, { value: 'security', label: 'Seguridad' }] },
      { name: 'status', label: 'Estado', type: 'select', required: true, options: opts({ open: 'Abierto', acknowledged: 'En atención', resolved: 'Resuelto' }) },
      { name: 'description', label: 'Descripción', type: 'textarea' },
      { name: 'resolution', label: 'Resolución', type: 'textarea' },
    ],
  });

  const upsert = useCallback((i) => list.setData((l) => [i, ...(l || []).filter((x) => x.id !== i.id)]), [list]);
  const onNew = useCallback((i) => {
    upsert(i);
    navigator.vibrate?.([500, 200, 500, 200, 500]);
  }, [upsert]);
  useSocketEvent('incident:new', onNew);
  useSocketEvent('incident:updated', upsert);

  const fire = async (type) => {
    try {
      upsert((await api.post('/incidents', { type, ...(await currentPosition(4000)) })).data);
      setMsg({ ok: 'Alerta enviada. La guardia fue notificada.' });
    } catch (err) {
      setMsg({ error: errMsg(err) });
    }
  };

  const act = async (i, action) => {
    try {
      const body = action === 'resolve' ? { resolution: prompt('Detalle de la resolución') || '' } : undefined;
      if (action === 'resolve' && body.resolution.length < 3) { return; }
      upsert((await api.post(`/incidents/${i.id}/${action}`, body)).data);
    } catch (err) {
      setMsg({ error: errMsg(err) });
    }
  };

  const showAudit = async (i) => setAuditOf({ i, log: (await api.get(`/incidents/${i.id}/audit`)).data });

  return (
    <div className="space-y-4">
      <PageTitle>Emergencias</PageTitle>
      <Alert msg={msg.error} />
      <Alert msg={msg.ok} type="ok" />

      <div className="grid gap-4 sm:grid-cols-2">
        <HoldButton onFire={() => fire('medical')} className="rounded-2xl bg-red-600 py-10 text-2xl font-bold text-white shadow-lg">
          🚑 Emergencia médica
        </HoldButton>
        <HoldButton onFire={() => fire('security')} className="rounded-2xl bg-orange-600 py-10 text-2xl font-bold text-white shadow-lg">
          🚨 Seguridad
        </HoldButton>
      </div>
      <p className="text-center text-xs text-slate-500">Mantené presionado 2 segundos para enviar la alerta.</p>

      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Tipo</th><th>Fecha</th>{staff && <th>Reporta</th>}<th>Estado</th><th /></tr></thead>
          <tbody>
            {list.data?.map((i) => (
              <tr key={i.id} className={i.status === 'open' ? 'bg-red-50' : ''}>
                <td>{TYPE[i.type]}</td><td>{fmtDate(i.created_at)}</td>
                {staff && <td>{i.reporter} · Lote {i.lot_code || '—'}
                  {i.lat && <a className="ml-1 text-brand-700 underline" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${i.lat},${i.lng}`}>mapa</a>}</td>}
                <td><Status s={i.status} /></td>
                <td className="space-x-1 whitespace-nowrap">
                  {staff && i.status === 'open' && <button className="btn-primary" onClick={() => act(i, 'ack')}>Tomar</button>}
                  {staff && i.status !== 'resolved' && <button className="btn-secondary" onClick={() => act(i, 'resolve')}>Resolver</button>}
                  {staff && <button className="text-xs underline" onClick={() => showAudit(i)}>Auditoría</button>}
                  {crud.actions(i)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {crud.ui}
      {auditOf && (
        <div className="card">
          <div className="mb-2 flex justify-between"><b>Auditoría incidente #{auditOf.i.id}</b><button onClick={() => setAuditOf(null)}>✕</button></div>
          <ul className="text-sm">
            {auditOf.log.map((a) => <li key={a.id}>{fmtDate(a.created_at)} · <b>{a.action}</b> · {a.full_name} · IP {a.ip}</li>)}
          </ul>
          {auditOf.i.resolution && <p className="mt-2 text-sm">Resolución: {auditOf.i.resolution}</p>}
        </div>
      )}
    </div>
  );
}
