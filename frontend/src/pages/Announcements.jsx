import { useState } from 'react';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate } from '../lib/format';
import { useFetch } from '../hooks/useFetch';
import { useForm } from '../hooks/useForm';
import { Alert, Field, PageTitle } from '../components/ui';
import { Modal } from '../components/crud';
import { Icon } from '../components/icons';

const AUDIENCE = { all: 'Todo el complejo', owners: 'Propietarios y familia', residents: 'Residentes', staff: 'Personal (seguridad y administración)', user: 'Una persona' };

function Compose({ onClose, onSent }) {
  const f = useForm({ kind: 'announcement', audience: 'all', target_user_id: '', title: '', body: '' });
  const users = useFetch(f.values.audience === 'user' ? '/users' : null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const b = { ...f.values, target_user_id: f.values.audience === 'user' ? Number(f.values.target_user_id) : undefined };
      await api.post('/announcements', b);
      onSent();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };

  return (
    <Modal title="Nuevo comunicado" onClose={onClose}>
      <form onSubmit={send} className="space-y-3">
        <Alert msg={error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tipo">
            <select className="input" {...f.bind('kind')}>
              <option value="announcement">Comunicado</option>
              <option value="message">Mensaje de administración</option>
            </select>
          </Field>
          <Field label="Para">
            <select className="input" {...f.bind('audience')}>{Object.entries(AUDIENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </Field>
        </div>
        {f.values.audience === 'user' && (
          <Field label="Destinatario">
            <select className="input" required {...f.bind('target_user_id')}>
              <option value="">Elegir…</option>
              {users.data?.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.full_name}{u.lot_code ? ` · ${u.lot_code}` : ''}</option>)}
            </select>
          </Field>
        )}
        <Field label="Título"><input className="input" required minLength={3} maxLength={160} {...f.bind('title')} /></Field>
        <Field label="Mensaje"><textarea className="input min-h-32" required maxLength={5000} {...f.bind('body')} /></Field>
        <p className="text-xs text-slate-500">Se publica en Comunicados y se envía como notificación a los dispositivos de los destinatarios.</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={busy}>{busy ? 'Enviando…' : 'Publicar y notificar'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Comunicados del complejo y mensajes de la administración. */
export default function Announcements() {
  const { is } = useAuth();
  const admin = is('admin');
  const list = useFetch('/announcements');
  const [composing, setComposing] = useState(false);
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(null);

  const remove = async (a) => {
    if (!window.confirm(`¿Eliminar "${a.title}"?`)) { return; }
    try {
      await api.delete(`/announcements/${a.id}`);
      list.setData((l) => l.filter((x) => x.id !== a.id));
    } catch (e) { setMsg(errMsg(e)); }
  };

  return (
    <div className="space-y-4">
      <PageTitle action={admin && <button type="button" className="btn-primary" onClick={() => setComposing(true)}><Icon name="megaphone" className="h-4 w-4" />Nuevo</button>}>
        Comunicados
      </PageTitle>
      <Alert msg={list.error || msg} />
      {!list.data ? <p className="py-8 text-center text-sm text-slate-500">Cargando…</p>
        : !list.data.length ? <p className="card py-10 text-center text-sm text-slate-500">No hay comunicados.</p> : (
          <ul className="space-y-3">
            {list.data.map((a) => {
              const expanded = open === a.id;
              const long = a.body.length > 280;
              return (
                <li key={a.id} className="card">
                  <div className="flex items-start gap-3">
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${a.kind === 'message' ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' : 'bg-brand-100 text-brand-800 dark:bg-brand-500/15 dark:text-brand-200'}`}>
                      <Icon name={a.kind === 'message' ? 'message' : 'megaphone'} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-semibold [overflow-wrap:anywhere]">{a.title}</h2>
                      <p className="text-xs text-slate-500">
                        {a.kind === 'message' ? 'Mensaje de administración' : 'Comunicado'} · {fmtDate(a.created_at)}
                        {admin && ` · ${a.audience === 'user' ? `Para ${a.target_name || 'una persona'}` : AUDIENCE[a.audience]}`}
                      </p>
                    </div>
                    {admin && (
                      <button type="button" className="btn-secondary !px-3" onClick={() => remove(a)} aria-label={`Eliminar ${a.title}`}>
                        <Icon name="trash" className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <p className={`mt-3 whitespace-pre-line text-sm text-slate-700 [overflow-wrap:anywhere] dark:text-slate-200 ${long && !expanded ? 'line-clamp-4' : ''}`}>{a.body}</p>
                  {long && (
                    <button type="button" className="mt-1 min-h-11 text-sm font-medium text-brand-700 dark:text-brand-300" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : a.id)}>
                      {expanded ? 'Ver menos' : 'Leer completo'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      {composing && <Compose onClose={() => setComposing(false)} onSent={() => { setComposing(false); list.reload(); }} />}
    </div>
  );
}
