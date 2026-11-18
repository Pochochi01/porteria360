export const Field = ({ label, children }) => (
  <label className="block">
    <span className="label">{label}</span>
    {children}
  </label>
);

export const PageTitle = ({ children, action }) => (
  <div className="mb-4 flex items-center justify-between gap-2">
    <h1 className="text-xl font-semibold">{children}</h1>
    {action}
  </div>
);

export const Alert = ({ msg, type = 'error' }) =>
  msg ? (
    <div role={type === 'error' ? 'alert' : 'status'} className={`mb-3 rounded-lg px-3 py-2 text-sm ${type === 'error' ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'}`}>
      {msg}
    </div>
  ) : null;

const COLORS = {
  pending: 'bg-amber-100 text-amber-800', in_review: 'bg-amber-100 text-amber-800', open: 'bg-red-100 text-red-700',
  authorized: 'bg-sky-100 text-sky-800', acknowledged: 'bg-sky-100 text-sky-800', in_progress: 'bg-sky-100 text-sky-800',
  approved: 'bg-emerald-100 text-emerald-800', paid: 'bg-emerald-100 text-emerald-800', inside: 'bg-emerald-100 text-emerald-800',
  completed: 'bg-emerald-100 text-emerald-800', resolved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-700', incomplete: 'bg-red-100 text-red-700', cancelled: 'bg-slate-200 text-slate-600',
  exited: 'bg-slate-200 text-slate-600', expired: 'bg-slate-200 text-slate-600', not_required: 'bg-slate-100 text-slate-500',
  // Notificaciones
  queued: 'bg-slate-100 text-slate-600', sending: 'bg-sky-100 text-sky-800', sent: 'bg-emerald-100 text-emerald-800',
  partial: 'bg-amber-100 text-amber-800', failed: 'bg-red-100 text-red-700', no_devices: 'bg-slate-100 text-slate-500',
};
const LABELS = {
  pending: 'Pendiente', in_review: 'En revisión', authorized: 'Autorizada', approved: 'Aprobado', paid: 'Pagado',
  rejected: 'Rechazado', inside: 'Adentro', exited: 'Salió', expired: 'Vencida', in_progress: 'En curso',
  completed: 'Completa', incomplete: 'Incompleta', cancelled: 'Cancelada', open: 'Abierto', acknowledged: 'En atención',
  resolved: 'Resuelto', not_required: 'Sin cargo', refunded: 'Reintegrado',
  queued: 'En cola', sending: 'Enviando', sent: 'Enviada', partial: 'Parcial', failed: 'Fallida', no_devices: 'Sin dispositivo',
};
export const Status = ({ s }) => <span className={`badge ${COLORS[s] || 'bg-slate-100'}`}>{LABELS[s] || s}</span>;
