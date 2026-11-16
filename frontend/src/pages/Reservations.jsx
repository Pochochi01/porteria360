import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errMsg } from '../lib/api';
import { useAuth, useSocketEvent } from '../lib/auth';
import { Alert, Field, PageTitle, Status } from '../components/ui';
import { fmtDate, money, opts } from '../lib/format';
import { useFetch } from '../hooks/useFetch';
import { useForm } from '../hooks/useForm';
import { useCrud } from '../hooks/useCrud';

const SPACE_TYPES = { clubhouse: 'Club House', court: 'Cancha', pool: 'Pileta', other: 'Otro' };

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const PAY_MSG = { ok: 'Pago acreditado. ¡Gracias!', pendiente: 'Pago pendiente de acreditación.', error: 'El pago no se completó.' };

export default function Reservations() {
  const { is } = useAuth();
  const admin = is('admin');
  const [params] = useSearchParams();
  const spaces = useFetch('/spaces');
  const list = useFetch('/reservations');
  const [spaceId, setSpaceId] = useState('');
  const [date, setDate] = useState(today());
  const [avail, setAvail] = useState(null);
  const [msg, setMsg] = useState(params.get('pago') ? { ok: PAY_MSG[params.get('pago')] } : {});

  useEffect(() => { if (!spaceId && spaces.data?.length) { setSpaceId(String(spaces.data[0].id)); } }, [spaces.data, spaceId]);
  const loadAvail = useCallback(() => {
    if (spaceId) { api.get(`/spaces/${spaceId}/availability`, { params: { date } }).then((r) => setAvail(r.data)); }
  }, [spaceId, date]);
  useEffect(loadAvail, [loadAvail]);
  useSocketEvent('reservation:updated', list.reload);

  const resCrud = useCrud({
    path: '/reservations', label: 'reserva', onChange: () => { list.reload(); loadAvail(); }, canEdit: admin,
    fields: [
      { name: 'status', label: 'Estado', type: 'select', required: true,
        options: opts({ pending: 'Pendiente', approved: 'Aprobada', rejected: 'Rechazada', cancelled: 'Cancelada' }) },
      { name: 'payment_status', label: 'Pago', type: 'select', required: true,
        options: opts({ not_required: 'Sin cargo', pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado', refunded: 'Reintegrado' }) },
      { name: 'review_note', label: 'Nota', type: 'textarea' },
    ],
  });
  const spaceCrud = useCrud({
    path: '/spaces', label: 'espacio', onChange: () => { spaces.reload(); loadAvail(); },
    fields: [
      { name: 'name', label: 'Nombre', required: true },
      { name: 'type', label: 'Tipo', type: 'select', required: true, options: opts(SPACE_TYPES) },
      { name: 'capacity', label: 'Cupos por franja', type: 'number', required: true },
      { name: 'slot_minutes', label: 'Duración (min)', type: 'number', required: true },
      { name: 'open_time', label: 'Abre', type: 'time', required: true },
      { name: 'close_time', label: 'Cierra', type: 'time', required: true },
      { name: 'max_per_lot_week', label: 'Máx. por lote/semana', type: 'number', required: true },
      { name: 'min_advance_hours', label: 'Anticipación mín. (h)', type: 'number', required: true },
      { name: 'max_advance_days', label: 'Anticipación máx. (días)', type: 'number', required: true },
      { name: 'price', label: 'Precio', type: 'number', step: '0.01', required: true },
      { name: 'requires_approval', label: 'Requiere aprobación', type: 'checkbox' },
      { name: 'active', label: 'Activo', type: 'checkbox' },
    ],
  });

  const act = async (fn, ok) => {
    try { await fn(); setMsg({ ok }); list.reload(); loadAvail(); } catch (err) { setMsg({ error: errMsg(err) }); }
  };

  const book = (slot) => act(async () => {
    const { data } = await api.post('/reservations', { space_id: Number(spaceId), start_at: slot.start });
    if (data.requires_payment) { await pay(data.id); }
  }, 'Reserva solicitada');

  // Redirección al checkout de MercadoPago
  const pay = async (id) => {
    const { data } = await api.post(`/pagos/reservations/${id}/preference`);
    window.location.href = data.init_point;
  };

  const review = (r, approve) => act(() => api.post(`/reservations/${r.id}/review`, { approve, note: approve ? undefined : prompt('Motivo del rechazo') || undefined }), approve ? 'Aprobada' : 'Rechazada');

  return (
    <div className="space-y-4">
      <PageTitle>Reservas</PageTitle>
      <Alert msg={msg.error} />
      <Alert msg={msg.ok} type="ok" />
      {admin && <SpaceForm onCreated={spaces.reload} />}
      {admin && !!spaces.data?.length && (
        <div className="card overflow-x-auto">
          <h2 className="mb-2 font-semibold">Espacios</h2>
          <table className="table">
            <thead><tr><th>Nombre</th><th>Tipo</th><th>Horario</th><th>Cupos</th><th>Precio</th><th /></tr></thead>
            <tbody>
              {spaces.data.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td><td>{SPACE_TYPES[s.type]}</td><td>{s.open_time.slice(0, 5)}–{s.close_time.slice(0, 5)}</td>
                  <td>{s.capacity}</td><td>{Number(s.price) ? money(s.price) : 'Gratis'}</td>
                  <td className="text-right">{spaceCrud.actions(s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Espacio">
            <select className="input" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
              {spaces.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Fecha"><input type="date" className="input" min={today()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        {avail && (
          <>
            <p className="text-xs text-slate-500">
              Cupo {avail.space.capacity} · {avail.space.slot_minutes} min · máx. {avail.space.max_per_lot_week}/semana por lote ·
              anticipación mín. {avail.space.min_advance_hours} h {Number(avail.space.price) > 0 && `· ${money(avail.space.price)}`}
              {avail.space.requires_approval ? ' · requiere aprobación' : ''}
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {avail.slots.map((s) => (
                <button key={s.start} disabled={!s.free || admin} onClick={() => book(s)}
                  className={`rounded-lg border p-2 text-sm ${s.free ? 'border-brand-600 hover:bg-brand-50' : 'border-slate-200 bg-slate-100 text-slate-400'}`}>
                  {s.start.slice(11, 16)}
                  <div className="text-xs">{s.free ? `${s.free} libre${s.free > 1 ? 's' : ''}` : 'Completo'}</div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Espacio</th>{admin && <th>Lote</th>}<th>Fecha</th><th>Estado</th><th>Pago</th><th /></tr></thead>
          <tbody>
            {list.data?.map((r) => (
              <tr key={r.id}>
                <td>{r.space_name}</td>{admin && <td>{r.lot_code} · {r.full_name}</td>}
                <td>{fmtDate(r.start_at)}</td><td><Status s={r.status} /></td><td><Status s={r.payment_status} /></td>
                <td className="space-x-1 whitespace-nowrap">
                  {admin && r.status === 'pending' && <>
                    <button className="btn-primary" onClick={() => review(r, true)}>Aprobar</button>
                    <button className="btn-danger" onClick={() => review(r, false)}>Rechazar</button>
                  </>}
                  {!admin && r.payment_status === 'pending' && ['pending', 'approved'].includes(r.status) &&
                    <button className="btn-primary" onClick={() => act(() => pay(r.id))}>Pagar</button>}
                  {['pending', 'approved'].includes(r.status) &&
                    <button className="btn-secondary" onClick={() => act(() => api.post(`/reservations/${r.id}/cancel`), 'Cancelada')}>Cancelar</button>}
                  {admin && resCrud.actions(r)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {resCrud.ui}
      {spaceCrud.ui}
    </div>
  );
}

function SpaceForm({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const f = useForm({ name: '', type: 'court', capacity: 1, slot_minutes: 60, open_time: '08:00', close_time: '23:00',
    max_per_lot_week: 2, min_advance_hours: 2, max_advance_days: 30, requires_approval: true, price: 0 });
  const n = (k) => f.bind(k, Number);
  const submit = async (e) => {
    e.preventDefault();
    try { await api.post('/spaces', f.values); f.reset(); setOpen(false); onCreated(); } catch (err) { setError(errMsg(err)); }
  };
  if (!open) { return <button className="btn-secondary" onClick={() => setOpen(true)}>+ Nuevo espacio</button>; }
  return (
    <form onSubmit={submit} className="card grid gap-3 md:grid-cols-4">
      <Alert msg={error} />
      <Field label="Nombre"><input className="input" required {...f.bind('name')} /></Field>
      <Field label="Tipo">
        <select className="input" {...f.bind('type')}><option value="clubhouse">Club House</option><option value="court">Cancha</option><option value="pool">Pileta</option><option value="other">Otro</option></select>
      </Field>
      <Field label="Cupos por franja"><input type="number" min={1} className="input" {...n('capacity')} /></Field>
      <Field label="Duración (min)"><input type="number" min={15} className="input" {...n('slot_minutes')} /></Field>
      <Field label="Abre"><input type="time" className="input" {...f.bind('open_time')} /></Field>
      <Field label="Cierra"><input type="time" className="input" {...f.bind('close_time')} /></Field>
      <Field label="Máx. por lote/semana"><input type="number" min={1} className="input" {...n('max_per_lot_week')} /></Field>
      <Field label="Anticipación mín. (h)"><input type="number" min={0} className="input" {...n('min_advance_hours')} /></Field>
      <Field label="Anticipación máx. (días)"><input type="number" min={1} className="input" {...n('max_advance_days')} /></Field>
      <Field label="Precio (0 = gratis)"><input type="number" min={0} className="input" {...n('price')} /></Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.values.requires_approval} onChange={(e) => f.setValues((v) => ({ ...v, requires_approval: e.target.checked }))} /> Requiere aprobación
      </label>
      <div className="flex items-end gap-2"><button className="btn-primary">Crear</button><button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cerrar</button></div>
    </form>
  );
}
