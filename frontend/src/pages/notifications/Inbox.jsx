import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errMsg } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { useSocketEvent } from '../../lib/auth';
import { notificationsChanged } from '../../hooks/useNotifications';
import { Alert } from '../../components/ui';
import { CATEGORY_LABELS } from '../../lib/notificationLabels';

/** Bandeja del usuario: todo lo que se le notificó, aunque no tenga dispositivos registrados. */
export function Inbox() {
  const navigate = useNavigate();
  const [items, setItems] = useState(null);
  const [unread, setUnread] = useState(0);
  const [category, setCategory] = useState('');
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (before) => {
    try {
      const { data } = await api.get('/notifications', { params: { category: category || undefined, before, limit: 30 } });
      setItems((l) => (before ? [...(l || []), ...data.items] : data.items));
      setUnread(data.unread);
      setMore(data.items.length === 30);
    } catch (e) { setError(errMsg(e)); }
  }, [category]);
  useEffect(() => { load(); }, [load]);
  const onNew = useCallback(() => load(), [load]);
  useSocketEvent('notification:new', onNew);

  const open = async (n) => {
    if (!n.read_at) {
      await api.post(`/notifications/${n.id}/read`).catch(() => {});
      notificationsChanged();
    }
    navigate(n.action_url || '/');
  };
  const readAll = async () => {
    await api.post('/notifications/read-all');
    notificationsChanged();
    load();
  };

  return (
    <div className="space-y-3">
      <Alert msg={error} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Mostrar</span>
          <select className="input !w-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {unread > 0 && <button type="button" className="btn-secondary" onClick={readAll}>Marcar todas como leídas ({unread})</button>}
      </div>

      {!items ? <p className="py-8 text-center text-sm text-slate-500">Cargando…</p>
        : !items.length ? <p className="card py-10 text-center text-sm text-slate-500">No tenés notificaciones{category ? ' en esta categoría' : ''}.</p>
          : (
            <ul className="card divide-y divide-slate-100 !p-0 dark:divide-slate-800">
              {items.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => open(n)}
                    className={`flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${n.read_at ? '' : 'bg-brand-50/60 dark:bg-brand-500/5'}`}>
                    <span aria-hidden="true" className={`mt-2 h-2 w-2 shrink-0 rounded-full ${n.read_at ? 'bg-transparent' : n.priority === 'high' ? 'bg-red-500' : 'bg-brand-600'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className={`${n.read_at ? 'font-medium' : 'font-semibold'} [overflow-wrap:anywhere]`}>{n.title}</span>
                        <time className="shrink-0 text-xs text-slate-500" dateTime={n.created_at}>{fmtDate(n.created_at)}</time>
                      </span>
                      <span className="mt-0.5 block text-sm text-slate-600 [overflow-wrap:anywhere] dark:text-slate-300">{n.body}</span>
                      <span className="mt-1 inline-block text-xs text-slate-500">
                        {CATEGORY_LABELS[n.category]}{!n.read_at && <span className="sr-only"> · sin leer</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
      {more && <button type="button" className="btn-secondary w-full" onClick={() => load(items.at(-1).id)}>Ver anteriores</button>}
    </div>
  );
}
