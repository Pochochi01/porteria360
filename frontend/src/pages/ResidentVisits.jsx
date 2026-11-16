import { useCallback, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api, errMsg } from '../lib/api';
import { useSocketEvent } from '../lib/auth';
import { Alert, Field, PageTitle, Status } from '../components/ui';
import { fmtDate } from '../lib/format';
import { useFetch } from '../hooks/useFetch';
import { useForm } from '../hooks/useForm';

const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export default function ResidentVisits() {
  const visits = useFetch('/visits');
  const now = new Date();
  const f = useForm({
    visitor_name: '', visitor_dni: '', vehicle_plate: '', type: 'visit',
    valid_from: local(now), valid_until: local(new Date(now.getTime() + 12 * 3600000)),
  });
  const [qr, setQr] = useState(null);
  const [error, setError] = useState('');

  const upsert = useCallback((v) => visits.setData((l) => [v, ...(l || []).filter((x) => x.id !== v.id)]), [visits]);
  const onRequest = useCallback((v) => {
    upsert(v);
    navigator.vibrate?.([300, 100, 300]);
  }, [upsert]);
  useSocketEvent('visit:request', onRequest);
  useSocketEvent('visit:updated', upsert);

  const createQr = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const body = { ...f.values };
      if (!body.visitor_dni) { delete body.visitor_dni; }
      if (!body.vehicle_plate) { delete body.vehicle_plate; }
      const { data } = await api.post('/visits/qr', body);
      setQr({ ...body, token: data.qr_token });
      visits.reload();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const decide = async (v, approve) => {
    try {
      upsert((await api.post(`/visits/${v.id}/decision`, { approve })).data);
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const share = () =>
    navigator.share?.({ title: 'Acceso al country', text: `QR de acceso para ${qr.visitor_name}: ${qr.token}` });

  const pending = visits.data?.filter((v) => v.status === 'pending') || [];

  return (
    <div className="space-y-4">
      <PageTitle>Mis visitas</PageTitle>
      <Alert msg={error} />

      {pending.map((v) => (
        <div key={v.id} className="card animate-pulse border-2 border-amber-400">
          <div className="font-semibold">🔔 {v.visitor_name} está en la guardia</div>
          <p className="text-sm text-slate-600">DNI {v.visitor_dni} {v.vehicle_plate && `· ${v.vehicle_plate}`} {v.notes && `· ${v.notes}`}</p>
          <div className="mt-3 flex gap-2">
            <button className="btn-primary" onClick={() => decide(v, true)}>Autorizar</button>
            <button className="btn-danger" onClick={() => decide(v, false)}>Rechazar</button>
          </div>
        </div>
      ))}

      <div className="grid gap-4 md:grid-cols-2">
        <form onSubmit={createQr} className="card space-y-3">
          <h2 className="font-semibold">Pre-autorizar visita (QR)</h2>
          <Field label="Nombre del visitante"><input className="input" required {...f.bind('visitor_name')} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="DNI"><input className="input" {...f.bind('visitor_dni')} /></Field>
            <Field label="Patente"><input className="input uppercase" {...f.bind('vehicle_plate')} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Desde"><input type="datetime-local" className="input" required {...f.bind('valid_from')} /></Field>
            <Field label="Hasta"><input type="datetime-local" className="input" required {...f.bind('valid_until')} /></Field>
          </div>
          <button className="btn-primary w-full">Generar QR</button>
        </form>

        {qr && (
          <div className="card flex flex-col items-center gap-3 text-center">
            <QRCodeSVG value={qr.token} size={220} />
            <div className="font-medium">{qr.visitor_name}</div>
            <div className="text-xs text-slate-500">Válido {fmtDate(qr.valid_from)} — {fmtDate(qr.valid_until)}</div>
            {navigator.share && <button className="btn-secondary" onClick={share}>Compartir</button>}
          </div>
        )}
      </div>

      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Visitante</th><th>Método</th><th>Estado</th><th>Entrada</th><th>Salida</th></tr></thead>
          <tbody>
            {visits.data?.map((v) => (
              <tr key={v.id}>
                <td>{v.visitor_name}</td><td>{v.auth_method === 'qr' ? 'QR' : 'En guardia'}</td>
                <td><Status s={v.status} /></td><td>{fmtDate(v.entry_at)}</td><td>{fmtDate(v.exit_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
