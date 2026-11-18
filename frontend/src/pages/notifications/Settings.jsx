import { useEffect, useState } from 'react';
import { api, errMsg } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { currentSubscription, enablePush, pushPermission, pushSupported, unlinkPush } from '../../lib/push';
import { usePwaInstall } from '../../hooks/usePwaInstall';
import { useFetch } from '../../hooks/useFetch';
import { Alert } from '../../components/ui';
import { Icon } from '../../components/icons';
import { CATEGORY_LABELS } from '../../lib/notificationLabels';

const HINTS = {
  security: 'Alertas de seguridad del complejo', access: 'Ingresos, egresos y accesos rechazados de tu unidad',
  visits: 'Invitaciones aprobadas, utilizadas o por vencer', reservations: 'Confirmaciones, cancelaciones y recordatorios',
  expenses: 'Liquidaciones, vencimientos y deudas', announcements: 'Comunicados y mensajes de la administración',
  emergencies: 'Emergencias médicas y de seguridad', alerts: 'Alertas operativas (rondas, sistema)',
};
const REMINDERS = {
  expense_due_days: { label: 'Vencimiento de expensas', unit: (v) => (v === 1 ? '1 día antes' : `${v} días antes`) },
  reservation_hours: { label: 'Recordatorio de reservas', unit: (v) => `${v} h antes` },
  invitation_hours: { label: 'Invitaciones por vencer', unit: (v) => `${v} h antes` },
};

function Switch({ checked, disabled, onChange, labelledBy, describedBy }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-labelledby={labelledBy} aria-describedby={describedBy} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-60 ${checked ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-700'}`}>
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

/** Estado del push en ESTE dispositivo y acciones (activar, probar). */
function DeviceStatus({ onChange }) {
  const { installed, platform } = usePwaInstall();
  const [perm, setPerm] = useState(pushPermission);
  const [msg, setMsg] = useState({ text: '', type: 'ok' });
  const [busy, setBusy] = useState(false);
  const iosBrowser = platform === 'ios' && !installed;

  const enable = async () => {
    setBusy(true);
    try {
      const r = await enablePush();
      setPerm(r);
      if (r === 'granted') { setMsg({ text: 'Listo: este dispositivo recibe notificaciones.', type: 'ok' }); onChange(); }
    } catch (e) { setMsg({ text: errMsg(e), type: 'error' }); } finally { setBusy(false); }
  };
  const test = async () => {
    try {
      await api.post('/notifications/test');
      setMsg({ text: 'Enviamos una notificación de prueba a tus dispositivos.', type: 'ok' });
    } catch (e) { setMsg({ text: errMsg(e), type: 'error' }); }
  };

  let state;
  if (!pushSupported() || iosBrowser) {
    state = iosBrowser ? 'En iPhone las notificaciones funcionan con la app instalada (Compartir → Agregar a inicio).' : 'Este navegador no admite notificaciones push.';
  } else if (perm === 'denied') {
    state = 'Bloqueaste las notificaciones. Habilitalas desde los ajustes del navegador o del dispositivo.';
  } else if (perm === 'granted') {
    state = 'Este dispositivo recibe notificaciones.';
  } else if (!installed) {
    state = 'Instalá la app para recibir notificaciones en este dispositivo.';
  } else {
    state = 'Las notificaciones están desactivadas en este dispositivo.';
  }

  return (
    <section className="card space-y-3" aria-labelledby="push-device">
      <div className="flex items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${perm === 'granted' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>
          <Icon name="bell" />
        </span>
        <div className="min-w-0">
          <h2 id="push-device" className="font-semibold">Este dispositivo</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">{state}</p>
        </div>
      </div>
      <Alert msg={msg.text} type={msg.type === 'error' ? 'error' : 'ok'} />
      <div className="flex flex-wrap gap-2">
        {installed && perm === 'default' && pushSupported() && <button type="button" className="btn-primary" disabled={busy} onClick={enable}>Activar notificaciones</button>}
        {perm === 'granted' && <button type="button" className="btn-secondary" onClick={test}>Enviar prueba</button>}
      </div>
    </section>
  );
}

function Devices({ version }) {
  const [endpoint, setEndpoint] = useState(null);
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { currentSubscription().then((s) => setEndpoint(s?.endpoint || null)).catch(() => {}); }, []);
  useEffect(() => {
    api.get('/notifications/devices', { headers: endpoint ? { 'X-Push-Endpoint': endpoint } : {} })
      .then((r) => setList(r.data)).catch((e) => setError(errMsg(e)));
  }, [endpoint, version]);

  const remove = async (d) => {
    try {
      if (d.current) { await unlinkPush(); } else { await api.delete(`/notifications/devices/${d.id}`); }
      setList((l) => l.filter((x) => x.id !== d.id));
    } catch (e) { setError(errMsg(e)); }
  };
  const icon = { ios: 'user', android: 'user', desktop: 'grid' };

  return (
    <section className="card" aria-labelledby="devices-title">
      <h2 id="devices-title" className="font-semibold">Dispositivos registrados</h2>
      <p className="mb-3 text-sm text-slate-500">Recibís las notificaciones en todos estos dispositivos.</p>
      <Alert msg={error} />
      {!list ? <p className="text-sm text-slate-500">Cargando…</p> : !list.length ? <p className="text-sm text-slate-500">Todavía no registraste ningún dispositivo.</p> : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {list.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-3">
              <Icon name={icon[d.platform] || 'grid'} className="h-5 w-5 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {d.device || 'Dispositivo'} · {d.browser || 'Navegador'}
                  {d.current && <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-800 dark:bg-brand-500/15 dark:text-brand-200">Este dispositivo</span>}
                </div>
                <div className="text-xs text-slate-500">Último uso {fmtDate(d.last_seen || d.created_at)}{d.channel === 'fcm' ? ' · FCM' : ''}</div>
              </div>
              <button type="button" className="btn-secondary !px-3" onClick={() => remove(d)} aria-label={`Quitar ${d.device || 'dispositivo'}`}>
                <Icon name="trash" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Preferencias por categoría y anticipación de los recordatorios. Se guardan al cambiar. */
export function Settings() {
  const prefs = useFetch('/notifications/preferences');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const p = prefs.data;

  const save = async (patch) => {
    const prev = p;
    prefs.setData({ ...p, categories: { ...p.categories, ...patch.categories }, reminders: { ...p.reminders, ...patch.reminders } }); // optimista
    setSaving(true);
    setError('');
    try {
      prefs.setData((await api.put('/notifications/preferences', patch)).data);
    } catch (e) {
      prefs.setData(prev);
      setError(errMsg(e));
    } finally { setSaving(false); }
  };
  const toggleReminder = (key, v) => {
    const cur = p.reminders[key] || [];
    save({ reminders: { [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] } });
  };

  return (
    <div className="space-y-4">
      <DeviceStatus onChange={() => setVersion((v) => v + 1)} />
      <Alert msg={error || prefs.error} />
      {p && (
        <>
          <section className="card" aria-labelledby="cat-title">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h2 id="cat-title" className="font-semibold">Qué querés recibir</h2>
              <span role="status" className="text-xs text-slate-500">{saving ? 'Guardando…' : ''}</span>
            </div>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {Object.keys(CATEGORY_LABELS).map((k) => {
                const locked = p.locked.includes(k);
                return (
                  <li key={k} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div id={`cat-${k}`} className="font-medium">{CATEGORY_LABELS[k]}</div>
                      <div id={`cat-${k}-hint`} className="text-xs text-slate-500">{locked ? 'Obligatorio para el personal de seguridad' : HINTS[k]}</div>
                    </div>
                    <Switch checked={!!p.categories[k]} disabled={locked} labelledBy={`cat-${k}`} describedBy={`cat-${k}-hint`}
                      onChange={(v) => save({ categories: { [k]: v } })} />
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card space-y-4" aria-labelledby="rem-title">
            <h2 id="rem-title" className="font-semibold">Recordatorios</h2>
            {Object.entries(REMINDERS).map(([key, r]) => (
              <fieldset key={key}>
                <legend className="label">{r.label}</legend>
                <div className="flex flex-wrap gap-2">
                  {p.options[key].map((v) => {
                    const on = p.reminders[key]?.includes(v);
                    return (
                      <button key={v} type="button" aria-pressed={on} onClick={() => toggleReminder(key, v)}
                        className={`btn !rounded-full border ${on ? 'border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-200' : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}>
                        {on && <Icon name="check" className="h-4 w-4" />}{r.unit(v)}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </section>
        </>
      )}
      <Devices version={version} />
    </div>
  );
}
