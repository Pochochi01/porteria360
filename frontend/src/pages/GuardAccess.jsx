import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import { api, errMsg } from '../lib/api';
import { useSocketEvent } from '../lib/auth';
import { Alert, Field, PageTitle, Status } from '../components/ui';
import { fmtDate, opts } from '../lib/format';
import { useFetch } from '../hooks/useFetch';
import { useForm } from '../hooks/useForm';
import { useCrud } from '../hooks/useCrud';

// Lector de DNI (PDF417 + OCR) y QR de invitaciones: se carga recién al abrirlo
const DniScanner = lazy(() => import('../components/DniScanner'));

const TYPES = { visit: 'Visita', delivery: 'Delivery', service: 'Servicio', worker: 'Obrero' };

export default function GuardAccess() {
  const visits = useFetch('/visits');
  const lots = useFetch('/lots');
  const f = useForm({ lot_id: '', visitor_name: '', visitor_dni: '', vehicle_plate: '', type: 'visit', notes: '' });
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState(null);
  const [msg, setMsg] = useState({});
  const formRef = useRef(null);
  const crud = useCrud({
    path: '/visits', label: 'visita', onChange: visits.reload,
    fields: [
      { name: 'visitor_name', label: 'Nombre', required: true },
      { name: 'visitor_dni', label: 'DNI' },
      { name: 'vehicle_plate', label: 'Patente' },
      { name: 'type', label: 'Tipo', type: 'select', required: true, options: opts(TYPES) },
      { name: 'status', label: 'Estado', type: 'select', required: true, options: opts({ pending: 'Pendiente', authorized: 'Autorizada', rejected: 'Rechazada', inside: 'Adentro', exited: 'Salió', expired: 'Vencida' }) },
      { name: 'valid_from', label: 'Válido desde', type: 'datetime' },
      { name: 'valid_until', label: 'Válido hasta', type: 'datetime' },
      { name: 'notes', label: 'Notas', type: 'textarea' },
    ],
  });

  const upsert = useCallback((v) => visits.setData((list) => [v, ...(list || []).filter((x) => x.id !== v.id)]), [visits]);
  useSocketEvent('visit:updated', upsert);

  const request = async (e) => {
    e.preventDefault();
    try {
      const body = { ...f.values, lot_id: Number(f.values.lot_id) };
      if (!body.vehicle_plate) { delete body.vehicle_plate; }
      if (!body.notes) { delete body.notes; }
      upsert((await api.post('/visits/request', body)).data);
      f.reset();
      setMsg({ ok: 'Solicitud enviada al lote. Esperando aprobación…' });
    } catch (err) {
      setMsg({ error: errMsg(err) });
    }
  };

  // QR de invitación detectado por el lector: mismo flujo de validación que antes
  const onInvitation = useCallback(async (text) => {
    setScanning(false);
    try {
      setScan((await api.post('/visits/scan', { qr_token: text.trim() })).data);
    } catch (err) {
      setMsg({ error: errMsg(err) });
    }
  }, []);

  // DNI confirmado: el formulario tiene un solo campo de nombre → "APELLIDO NOMBRE"
  const onDni = useCallback(({ nombreCompleto, dni }) => {
    setScanning(false);
    f.setValues((v) => ({ ...v, visitor_name: nombreCompleto, visitor_dni: dni }));
    setMsg({ ok: '✅ DNI leído correctamente · ✅ Datos autocompletados. Elegí el lote destino y enviá la solicitud.' });
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      formRef.current?.querySelector('select')?.focus({ preventScroll: true });
    });
  }, [f]);

  const act = async (v, action) => {
    try {
      upsert((await api.post(`/visits/${v.id}/${action}`)).data);
      setScan(null);
    } catch (err) {
      setMsg({ error: errMsg(err) });
    }
  };

  const closeScanner = useCallback(() => setScanning(false), []);

  const active = visits.data?.filter((v) => ['pending', 'authorized', 'inside'].includes(v.status)) || [];
  const history = visits.data?.filter((v) => !['pending', 'authorized', 'inside'].includes(v.status)).slice(0, 30) || [];

  return (
    <div className="space-y-4">
      <PageTitle action={<button className="btn-primary" onClick={() => setScanning(true)}>Escanear DNI</button>}>Control de accesos</PageTitle>
      <Alert msg={msg.error} />
      <Alert msg={msg.ok} type="ok" />
      {scanning && (
        <Suspense fallback={<div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/90"><span className="h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-white" /></div>}>
          <DniScanner onResult={onDni} onInvitation={onInvitation} onClose={closeScanner} />
        </Suspense>
      )}

      {scan && (
        <div className={`card border-2 ${scan.valid ? 'border-emerald-500' : 'border-red-500'}`}>
          <div className="text-lg font-semibold">{scan.valid ? '✅ QR válido' : '⛔ QR no válido / fuera de horario'}</div>
          <p className="text-sm">{scan.visit.visitor_name} · DNI {scan.visit.visitor_dni || '—'} · Lote {scan.visit.lot_code}</p>
          <p className="text-xs text-slate-500">Válido {fmtDate(scan.visit.valid_from)} a {fmtDate(scan.visit.valid_until)}</p>
          <div className="mt-3 flex gap-2">
            {scan.valid && <button className="btn-primary" onClick={() => act(scan.visit, 'entry')}>Registrar entrada</button>}
            <button className="btn-secondary" onClick={() => setScan(null)}>Cerrar</button>
          </div>
        </div>
      )}

      <form ref={formRef} onSubmit={request} className="card grid gap-3 md:grid-cols-3">
        <h2 className="font-semibold md:col-span-3">Visitante sin QR (pedir autorización)</h2>
        <Field label="Lote destino">
          <select className="input" required {...f.bind('lot_id')}>
            <option value="">Seleccionar…</option>
            {lots.data?.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}
          </select>
        </Field>
        <Field label="Nombre"><input className="input" required {...f.bind('visitor_name')} /></Field>
        <Field label="DNI"><input className="input" required {...f.bind('visitor_dni')} /></Field>
        <Field label="Patente"><input className="input uppercase" {...f.bind('vehicle_plate')} /></Field>
        <Field label="Tipo">
          <select className="input" {...f.bind('type')}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <Field label="Notas"><input className="input" {...f.bind('notes')} /></Field>
        <button className="btn-primary md:col-start-3">Solicitar autorización</button>
      </form>

      <div className="card overflow-x-auto">
        <h2 className="mb-2 font-semibold">En curso</h2>
        <table className="table">
          <thead><tr><th>Visitante</th><th>Lote</th><th>Tipo</th><th>Estado</th><th>Entrada</th><th /></tr></thead>
          <tbody>
            {active.map((v) => (
              <tr key={v.id}>
                <td>{v.visitor_name}<div className="text-xs text-slate-500">{v.visitor_dni} {v.vehicle_plate}</div></td>
                <td>{v.lot_code}</td>
                <td>{TYPES[v.type]}</td>
                <td><Status s={v.status} /></td>
                <td>{fmtDate(v.entry_at)}</td>
                <td>
                  {v.status === 'authorized' && <button className="btn-primary" onClick={() => act(v, 'entry')}>Entrada</button>}
                  {v.status === 'inside' && <button className="btn-secondary" onClick={() => act(v, 'exit')}>Salida</button>}
                  <span className="ml-1">{crud.actions(v)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="mb-2 font-semibold">Historial reciente</h2>
        <table className="table">
          <thead><tr><th>Visitante</th><th>Lote</th><th>Estado</th><th>Entrada</th><th>Salida</th><th /></tr></thead>
          <tbody>
            {history.map((v) => (
              <tr key={v.id}><td>{v.visitor_name}</td><td>{v.lot_code}</td><td><Status s={v.status} /></td><td>{fmtDate(v.entry_at)}</td><td>{fmtDate(v.exit_at)}</td><td className="text-right">{crud.actions(v)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {crud.ui}
    </div>
  );
}
