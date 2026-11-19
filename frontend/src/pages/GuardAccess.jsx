import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import { api, errMsg } from '../lib/api';
import { useAuth, useSocketEvent } from '../lib/auth';
import { Alert, Field, PageTitle, Status } from '../components/ui';
import { fmtDate, opts } from '../lib/format';
import { useFetch } from '../hooks/useFetch';
import { useForm } from '../hooks/useForm';
import { useCrud } from '../hooks/useCrud';
import { Icon } from '../components/icons';
import { LotPicker } from '../components/LotPicker';
import { MovementsList } from '../components/MovementsList';
import { InvitationCard } from '../components/InvitationCard';

// Lector de la guardia (QR de invitaciones y DNI con PDF417/OCR): se carga recién al abrirlo
const DniScanner = lazy(() => import('../components/DniScanner'));

const TYPES = { visit: 'Visita', delivery: 'Delivery', service: 'Servicio', worker: 'Obrero' };
const EMPTY = { visitor_name: '', visitor_dni: '', vehicle_plate: '', type: 'visit', notes: '' };

export default function GuardAccess() {
  const { is } = useAuth();
  const active = useFetch('/visits?view=active');
  const f = useForm(EMPTY);
  const [lot, setLot] = useState(null);
  const [scanner, setScanner] = useState(null); // 'invitation' | 'dni' | null
  const [invitation, setInvitation] = useState(null); // resultado de la validación
  const [dniForm, setDniForm] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({});
  const formRef = useRef(null);
  // La guardia registra movimientos pero no edita ni borra el historial (supervisor y admin sí)
  const crud = useCrud({
    path: '/visits', label: 'visita', onChange: active.reload, canEdit: is('supervisor', 'admin'),
    fields: [
      { name: 'visitor_name', label: 'Nombre', required: true },
      { name: 'visitor_dni', label: 'DNI' },
      { name: 'vehicle_plate', label: 'Patente' },
      { name: 'type', label: 'Tipo', type: 'select', required: true, options: opts(TYPES) },
      { name: 'status', label: 'Estado', type: 'select', required: true, options: opts({ pending: 'Pendiente', authorized: 'Autorizada', rejected: 'Rechazada', inside: 'Adentro', exited: 'Salió', expired: 'Vencida', cancelled: 'Cancelada' }) },
      { name: 'valid_from', label: 'Válido desde', type: 'datetime' },
      { name: 'valid_until', label: 'Válido hasta', type: 'datetime' },
      { name: 'notes', label: 'Notas', type: 'textarea' },
    ],
  });

  useSocketEvent('visit:updated', active.reload);

  const done = (text) => {
    setMsg({ ok: text });
    navigator.vibrate?.(80);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ---------- Flujo 1: invitación QR ----------
  const onInvitation = useCallback(async (token) => {
    setScanner(null);
    setMsg({});
    try {
      setInvitation((await api.get(`/visits/invitation/${encodeURIComponent(token)}`)).data);
    } catch (err) {
      setInvitation({ state: 'error', message: errMsg(err) });
    }
  }, []);

  const confirmEntry = async () => {
    setBusy(true);
    try {
      const v = (await api.post(`/visits/${invitation.invitation.id}/entry`)).data;
      setInvitation(null);
      done(`✅ Ingreso registrado: ${v.visitor_name} → Lote ${v.lot_code}`);
    } catch (err) {
      // Otro puesto la usó en el mismo momento: se muestra el motivo en la tarjeta
      setInvitation((r) => ({ ...r, state: 'used', can_enter: false, message: errMsg(err) }));
    } finally { setBusy(false); }
  };

  const rejectInvitation = async (why) => {
    setBusy(true);
    try {
      await api.post('/visits/reject', { visit_id: invitation.invitation.id, reason: why || undefined });
      setInvitation(null);
      done('Ingreso rechazado y registrado.');
    } catch (err) { setMsg({ error: errMsg(err) }); } finally { setBusy(false); }
  };

  // ---------- Flujo 2: DNI ----------
  const onDni = useCallback(({ nombreCompleto, dni }) => {
    setScanner(null);
    f.setValues({ ...EMPTY, visitor_name: nombreCompleto, visitor_dni: dni });
    setLot(null);
    setDniForm(true);
    setMsg({});
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [f]);

  const closeDni = () => { setDniForm(false); setRejecting(false); setReason(''); f.reset(); setLot(null); };
  const payload = () => {
    const b = { ...f.values, lot_id: lot?.id };
    for (const k of ['vehicle_plate', 'notes']) { if (!b[k]) { delete b[k]; } }
    return b;
  };
  const submitDni = async (action) => {
    if (!lot) { setMsg({ error: 'Elegí el lote destino.' }); return; }
    if (!formRef.current.reportValidity()) { return; }
    setBusy(true);
    try {
      if (action === 'entry') {
        const v = (await api.post('/visits/walk-in', payload())).data;
        done(`✅ Ingreso registrado: ${v.visitor_name} → Lote ${v.lot_code}`);
      } else if (action === 'request') {
        await api.post('/visits/request', payload());
        done('Solicitud enviada al lote. Esperando aprobación…');
      } else {
        await api.post('/visits/reject', { ...payload(), reason: reason || undefined });
        done('Rechazo registrado.');
      }
      closeDni();
    } catch (err) { setMsg({ error: errMsg(err) }); } finally { setBusy(false); }
  };

  const act = async (v, action) => {
    try {
      await api.post(`/visits/${v.id}/${action}`);
      active.reload();
    } catch (err) { setMsg({ error: errMsg(err) }); }
  };
  const closeScanner = useCallback(() => setScanner(null), []);
  const list = active.data || [];

  return (
    <div className="space-y-4">
      <PageTitle>Control de accesos</PageTitle>

      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => { setInvitation(null); setScanner('invitation'); }}
          className="btn-primary h-24 flex-col !gap-1.5 rounded-2xl text-sm font-bold uppercase tracking-wide shadow-md sm:h-20 sm:flex-row sm:text-base">
          <Icon name="qr" className="h-7 w-7" />Escanear invitación
        </button>
        <button type="button" onClick={() => { setInvitation(null); setScanner('dni'); }}
          className="btn h-24 flex-col !gap-1.5 rounded-2xl bg-slate-900 text-sm font-bold uppercase tracking-wide text-white shadow-md hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 sm:h-20 sm:flex-row sm:text-base">
          <Icon name="card" className="h-7 w-7" />Escanear DNI
        </button>
      </div>

      <Alert msg={msg.error} />
      <Alert msg={msg.ok} type="ok" />

      {scanner && (
        <Suspense fallback={<div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/90"><span className="h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-white" /></div>}>
          <DniScanner mode={scanner} onResult={onDni} onInvitation={onInvitation} onClose={closeScanner} />
        </Suspense>
      )}

      {invitation && (
        <InvitationCard result={invitation} busy={busy} onConfirm={confirmEntry} onReject={rejectInvitation}
          onRescan={() => { setInvitation(null); setScanner('invitation'); }} onClose={() => setInvitation(null)} />
      )}

      {dniForm ? (
        <form ref={formRef} onSubmit={(e) => { e.preventDefault(); submitDni('entry'); }} className="card space-y-3" aria-labelledby="dni-title">
          <div className="flex items-center justify-between gap-2">
            <h2 id="dni-title" className="font-semibold">Ingreso con DNI</h2>
            <button type="button" className="text-sm text-brand-700 underline dark:text-brand-300" onClick={() => setScanner('dni')}>Volver a escanear</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre completo"><input className="input uppercase" required minLength={2} {...f.bind('visitor_name')} /></Field>
            <Field label="DNI"><input className="input font-mono" required inputMode="numeric" pattern="[0-9.]{6,11}" {...f.bind('visitor_dni')} /></Field>
          </div>
          <LotPicker value={lot} onChange={setLot} required />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Tipo">
              <select className="input" {...f.bind('type')}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </Field>
            <Field label="Patente (opcional)"><input className="input uppercase" maxLength={15} {...f.bind('vehicle_plate')} /></Field>
            <Field label="Notas (opcional)"><input className="input" maxLength={255} {...f.bind('notes')} /></Field>
          </div>
          {rejecting ? (
            <div className="space-y-2 rounded-xl bg-red-50 p-3 dark:bg-red-500/10">
              <Field label="Motivo del rechazo (opcional)"><input className="input" maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn-secondary" onClick={() => setRejecting(false)}>Volver</button>
                <button type="button" className="btn-danger" disabled={busy} onClick={() => submitDni('reject')}>Confirmar rechazo</button>
              </div>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <button className="btn-primary h-12 text-base sm:col-span-2" disabled={busy}><Icon name="check" />Registrar ingreso</button>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => submitDni('request')}>Pedir autorización al lote</button>
              <button type="button" className="btn-secondary text-red-700 dark:text-red-300" onClick={() => setRejecting(true)}>Rechazar</button>
              <button type="button" className="btn-secondary sm:col-span-2" onClick={closeDni}>Cancelar</button>
            </div>
          )}
        </form>
      ) : (
        <button type="button" className="text-sm text-brand-700 underline dark:text-brand-300" onClick={() => { f.reset(); setLot(null); setDniForm(true); }}>
          Cargar visitante sin escanear
        </button>
      )}

      {list.length > 0 && (
        <section className="card" aria-labelledby="active-title">
          <h2 id="active-title" className="mb-2 font-semibold">En curso <span className="text-sm font-normal text-slate-500">({list.length})</span></h2>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {list.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium [overflow-wrap:anywhere]">{v.visitor_name}</div>
                  <div className="text-xs text-slate-500">DNI {v.visitor_dni || '—'} · Lote {v.lot_code} · {TYPES[v.type]}{v.entry_at ? ` · entró ${fmtDate(v.entry_at)}` : ''}</div>
                </div>
                <Status s={v.status} />
                <div className="flex items-center gap-1">
                  {v.status === 'authorized' && <button type="button" className="btn-primary" onClick={() => act(v, 'entry')}>Entrada</button>}
                  {v.status === 'inside' && <button type="button" className="btn-secondary" onClick={() => act(v, 'exit')}>Salida</button>}
                  {crud.actions(v)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <MovementsList onExit={(m) => act(m, 'exit')} />
      {crud.ui}
    </div>
  );
}
