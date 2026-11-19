import { useState } from 'react';
import { fmtDate } from '../lib/format';
import { Icon } from './icons';

const INVITATION_STATE = {
  pending: { label: 'Pendiente de ingreso', tone: 'ok' },
  not_yet: { label: 'Todavía no vigente', tone: 'warn' },
  used: { label: 'Utilizada', tone: 'bad' },
  expired: { label: 'Vencida', tone: 'bad' },
  cancelled: { label: 'Cancelada', tone: 'bad' },
  rejected: { label: 'Rechazada', tone: 'bad' },
  error: { label: 'No válida', tone: 'bad' },
};
const TONE = {
  ok: { ring: 'border-emerald-500', chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300', icon: 'check' },
  warn: { ring: 'border-amber-500', chip: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300', icon: 'alert' },
  bad: { ring: 'border-red-500', chip: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300', icon: 'x' },
};
const TYPES = { visit: 'Visita', delivery: 'Delivery', service: 'Servicio', worker: 'Obrero' };

function Row({ k, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{k}</dt>
      <dd className="text-base font-semibold [overflow-wrap:anywhere]">{children || '—'}</dd>
    </div>
  );
}

/**
 * Tarjeta de validación de una invitación escaneada.
 * @param {{ result: { invitation?: any, state: string, message: string, can_enter?: boolean },
 *           busy?: boolean, onConfirm: () => void, onReject: (reason: string) => void, onRescan: () => void, onClose: () => void }} props
 */
export function InvitationCard({ result, busy, onConfirm, onReject, onRescan, onClose }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const st = INVITATION_STATE[result.state] || INVITATION_STATE.error;
  const tone = TONE[st.tone];
  const inv = result.invitation;
  const canReject = inv && ['pending', 'not_yet', 'expired'].includes(result.state);

  return (
    <section className={`card border-2 ${tone.ring}`} aria-labelledby="inv-title" aria-live="assertive">
      <div className="mb-3 flex items-start gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${tone.chip}`}><Icon name={tone.icon} /></span>
        <div className="min-w-0 flex-1">
          <h2 id="inv-title" className="text-lg font-bold">{inv ? 'Invitación' : 'Invitación no válida'}</h2>
          <p className={`mt-0.5 inline-block rounded-full px-2.5 py-0.5 text-sm font-semibold ${tone.chip}`}>{st.label}</p>
        </div>
      </div>
      {result.state !== 'pending' && <p role="alert" className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium dark:bg-slate-800">{result.message}</p>}

      {inv && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div className="col-span-2"><Row k="Visitante">{inv.visitor_name}</Row></div>
          <Row k="DNI"><span className="font-mono tracking-wide">{inv.visitor_dni}</span></Row>
          <Row k="Destino">Lote {inv.lot_code}</Row>
          <div className="col-span-2"><Row k="Familia">{inv.family}</Row></div>
          <Row k="Fecha">{fmtDate(inv.valid_from)}</Row>
          <Row k="Hasta">{fmtDate(inv.valid_until)}</Row>
          <Row k="Tipo">{TYPES[inv.type]}{inv.vehicle_plate ? ` · ${inv.vehicle_plate}` : ''}</Row>
          <Row k="Invitó">{inv.invited_by}</Row>
          {inv.notes && <div className="col-span-2"><Row k="Observaciones">{inv.notes}</Row></div>}
        </dl>
      )}

      {rejecting ? (
        <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); onReject(reason); }}>
          <label className="block"><span className="label">Motivo del rechazo (opcional)</span>
            <input className="input" maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-secondary" onClick={() => setRejecting(false)}>Volver</button>
            <button className="btn-danger" disabled={busy}>Confirmar rechazo</button>
          </div>
        </form>
      ) : (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {result.can_enter && (
            <button type="button" className="btn-primary h-14 text-base sm:col-span-2" disabled={busy} onClick={onConfirm}>
              <Icon name="check" />{busy ? 'Registrando…' : 'CONFIRMAR INGRESO'}
            </button>
          )}
          {canReject && <button type="button" className="btn-secondary text-red-700 dark:text-red-300" onClick={() => setRejecting(true)}>Rechazar ingreso</button>}
          <button type="button" className="btn-secondary" onClick={onRescan}><Icon name="qr" className="h-4 w-4" />Escanear otra</button>
          <button type="button" className="btn-secondary" onClick={onClose}>Cerrar</button>
        </div>
      )}
    </section>
  );
}
