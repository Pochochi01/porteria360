import { useCallback, useEffect, useState } from 'react';
import { api, errMsg } from '../../lib/api';
import { fmtDate, fmtPct } from '../../lib/format';
import { useFetch } from '../../hooks/useFetch';
import { Alert, Status } from '../../components/ui';
import { MetricCard } from '../../components/MetricCard';
import { CATEGORY_LABELS } from '../../lib/notificationLabels';

const PLATFORM = { ios: 'iPhone / iPad', android: 'Android', desktop: 'Escritorio', other: 'Otros' };
const pct = (a, b) => (b ? (a / b) * 100 : 0);

/** Métricas de entrega del complejo. */
export function NotificationStats() {
  const [days, setDays] = useState(30);
  const { data: s, error } = useFetch(`/notifications/admin/stats?days=${days}`);
  const t = s?.totals;
  const delivered = t ? t.sent : 0;
  const maxDay = Math.max(1, ...(s?.daily || []).map((d) => d.total));
  const devices = (s?.devices || []).reduce((a, d) => a + d.n, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Período</span>
          <select className="input !w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Últimos 7 días</option><option value={30}>Últimos 30 días</option><option value={90}>Últimos 90 días</option>
          </select>
        </label>
      </div>
      <Alert msg={error} />
      {s && !s.push_enabled && <Alert msg="El servidor no tiene configuradas las claves VAPID: las notificaciones quedan solo en la bandeja de la app." />}
      {t && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <MetricCard label="Enviadas" value={delivered} hint={`de ${t.total} generadas`} tone="good" />
            <MetricCard label="Leídas" value={t.read_count} hint={`${fmtPct(pct(t.read_count, t.total))} de apertura`} />
            <MetricCard label="Pendientes" value={t.pending} tone={t.pending ? 'warn' : 'default'} hint="En cola o reintentando" />
            <MetricCard label="Fallidas" value={t.failed} tone={t.failed ? 'bad' : 'good'} />
            <MetricCard label="Sin dispositivo" value={t.no_devices} hint="Solo en la bandeja" />
            <MetricCard label="Entrega a dispositivos" value={t.devices_targeted ? fmtPct(pct(t.devices_delivered, t.devices_targeted)) : '—'}
              hint={t.devices_targeted ? `${t.devices_delivered} de ${t.devices_targeted} envíos` : 'Sin envíos a dispositivos'}
              tone={!t.devices_targeted ? 'default' : pct(t.devices_delivered, t.devices_targeted) >= 90 ? 'good' : 'warn'} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card" aria-labelledby="daily-title">
              <h2 id="daily-title" className="mb-3 font-semibold">Últimos 14 días</h2>
              {!s.daily.length ? <p className="text-sm text-slate-500">Sin envíos.</p> : (
                <ul className="space-y-1.5">
                  {s.daily.map((d) => (
                    <li key={d.day} className="grid grid-cols-[4.5rem_1fr_2.5rem] items-center gap-2 text-xs">
                      <span className="text-slate-500">{String(d.day).slice(5, 10).split('-').reverse().join('/')}</span>
                      <span className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden="true">
                        <span className="block h-full rounded-full bg-brand-600" style={{ width: `${(d.total / maxDay) * 100}%` }} />
                      </span>
                      <span className="text-right tabular-nums">{d.total}{d.failed ? <span className="sr-only">, {d.failed} fallidas</span> : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card" aria-labelledby="dev-title">
              <h2 id="dev-title" className="mb-3 font-semibold">Dispositivos registrados · {devices}</h2>
              {!s.devices.length ? <p className="text-sm text-slate-500">Ningún usuario activó las notificaciones todavía.</p> : (
                <table className="table">
                  <thead><tr><th>Plataforma</th><th className="text-right">Dispositivos</th><th className="text-right">Usuarios</th><th className="text-right">Activos 30 d</th></tr></thead>
                  <tbody>{s.devices.map((d) => (
                    <tr key={d.platform}><td>{PLATFORM[d.platform] || d.platform}</td><td className="text-right">{d.n}</td><td className="text-right">{d.users}</td><td className="text-right">{d.active}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </section>
          </div>

          <section className="card overflow-x-auto" aria-labelledby="cat-title">
            <h2 id="cat-title" className="mb-3 font-semibold">Por categoría</h2>
            <table className="table">
              <thead><tr><th>Categoría</th><th className="text-right">Generadas</th><th className="text-right">Enviadas</th><th className="text-right">Leídas</th></tr></thead>
              <tbody>{s.byCategory.map((c) => (
                <tr key={c.category}><td>{CATEGORY_LABELS[c.category] || c.category}</td><td className="text-right">{c.total}</td><td className="text-right">{c.sent}</td><td className="text-right">{c.read_count}</td></tr>
              ))}</tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

const STATUS_FILTER = [['', 'Todos'], ['sent', 'Enviadas'], ['read', 'Leídas'], ['pending', 'Pendientes'], ['failed', 'Fallidas'], ['partial', 'Parciales'], ['no_devices', 'Sin dispositivo']];
const PAGE = 50;

/** Historial completo (auditoría), con filtros. */
export function NotificationHistory() {
  const [f, setF] = useState({ status: '', category: '', q: '' });
  const [rows, setRows] = useState(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (offset = 0) => {
    try {
      const { data } = await api.get('/notifications/admin/history', { params: { ...f, limit: PAGE, offset } });
      setRows((r) => (offset ? [...r, ...data] : data));
      setMore(data.length === PAGE);
    } catch (e) { setError(errMsg(e)); }
  }, [f]);
  useEffect(() => {
    const t = setTimeout(() => load(0), f.q ? 300 : 0); // la búsqueda espera a que termine de escribir
    return () => clearTimeout(t);
  }, [load, f.q]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block"><span className="label">Buscar</span><input className="input" type="search" placeholder="Texto o destinatario" value={f.q} onChange={set('q')} /></label>
        <label className="block"><span className="label">Estado</span>
          <select className="input" value={f.status} onChange={set('status')}>{STATUS_FILTER.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="block"><span className="label">Categoría</span>
          <select className="input" value={f.category} onChange={set('category')}>
            <option value="">Todas</option>{Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      <Alert msg={error} />
      <div className="card overflow-x-auto !p-0">
        <table className="table min-w-[720px]">
          <thead><tr><th className="!pl-4">Fecha</th><th>Destinatario</th><th>Notificación</th><th>Estado</th><th className="text-right">Disp.</th><th className="!pr-4">Leída</th></tr></thead>
          <tbody>
            {rows?.map((n) => (
              <tr key={n.id}>
                <td className="whitespace-nowrap !pl-4 text-xs">{fmtDate(n.created_at)}</td>
                <td className="max-w-[10rem] truncate">{n.user_name}</td>
                <td className="max-w-[18rem]">
                  <div className="truncate font-medium">{n.title}</div>
                  <div className="truncate text-xs text-slate-500" title={n.last_error || undefined}>
                    {CATEGORY_LABELS[n.category]}{n.attempts > 1 ? ` · ${n.attempts} intentos` : ''}{n.last_error && n.status !== 'sent' ? ` · ${n.last_error}` : ''}
                  </div>
                </td>
                <td><Status s={n.status} /></td>
                <td className="text-right tabular-nums">{n.delivered_count}/{n.device_count}</td>
                <td className="whitespace-nowrap !pr-4 text-xs">{n.read_at ? fmtDate(n.read_at) : '—'}</td>
              </tr>
            ))}
            {rows && !rows.length && <tr><td colSpan={6} className="py-8 text-center text-sm text-slate-500">Sin notificaciones con esos filtros.</td></tr>}
          </tbody>
        </table>
      </div>
      {more && <button type="button" className="btn-secondary w-full" onClick={() => load(rows.length)}>Ver más</button>}
    </div>
  );
}
