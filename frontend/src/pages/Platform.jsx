import { useState } from 'react';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Field, PageTitle } from '../components/ui';
import { fmtDate } from '../lib/format';
import { useFetch } from '../hooks/useFetch';
import { useForm } from '../hooks/useForm';
import { useCrud } from '../hooks/useCrud';

// "Los Robles Ñandú" → "los-robles-nandu"; keepTrailing permite seguir tipeando un guion
const toSlug = (s, keepTrailing = false) => {
  const r = s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '');
  return keepTrailing ? r.slice(0, 60) : r.replace(/-+$/, '').slice(0, 60);
};

export default function Platform() {
  const { enterTenant } = useAuth();
  const tenants = useFetch('/platform/tenants');
  const f = useForm({ name: '', slug: '', admin_name: '', admin_email: '', admin_password: '' });
  const [msg, setMsg] = useState({});
  const crud = useCrud({
    path: '/platform/tenants', label: 'complejo', deleteRoles: ['superadmin'], onChange: tenants.reload,
    fields: [
      { name: 'name', label: 'Nombre', required: true },
      { name: 'slug', label: 'Identificador (login)', required: true },
      { name: 'active', label: 'Activo', type: 'checkbox' },
    ],
  });

  const create = async (e) => {
    e.preventDefault();
    try {
      const { slugTouched, ...body } = f.values;
      await api.post('/platform/tenants', { ...body, slug: toSlug(body.slug) });
      f.reset();
      tenants.reload();
      setMsg({ ok: 'Complejo creado' });
    } catch (err) {
      setMsg({ error: errMsg(err) });
    }
  };

  const toggle = async (t) => {
    await api.patch(`/platform/tenants/${t.id}`, { active: !t.active });
    tenants.reload();
  };

  return (
    <div className="space-y-4">
      <PageTitle>Complejos</PageTitle>
      <Alert msg={msg.error} />
      <Alert msg={msg.ok} type="ok" />

      <form onSubmit={create} className="card grid gap-3 md:grid-cols-3">
        <h2 className="font-semibold md:col-span-3">Nuevo complejo</h2>
        <Field label="Nombre">
          <input className="input" required value={f.values.name}
            onChange={(e) => { const name = e.target.value; f.setValues((v) => ({ ...v, name, slug: v.slugTouched ? v.slug : toSlug(name) })); }} />
        </Field>
        <Field label="Identificador (para el login)">
          <input className="input" required placeholder="los-robles" value={f.values.slug}
            onChange={(e) => f.setValues((v) => ({ ...v, slug: toSlug(e.target.value, true), slugTouched: true }))} />
        </Field>
        <div />
        <Field label="Nombre del administrador"><input className="input" required {...f.bind('admin_name')} /></Field>
        <Field label="Email del administrador"><input className="input" type="email" required {...f.bind('admin_email')} /></Field>
        <Field label="Contraseña inicial"><input className="input" type="password" minLength={8} required {...f.bind('admin_password')} /></Field>
        <button className="btn-primary md:col-start-3">Crear complejo</button>
      </form>

      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Complejo</th><th>Identificador</th><th>Lotes</th><th>Usuarios</th><th>MercadoPago</th><th>Alta</th><th /></tr></thead>
          <tbody>
            {tenants.data?.map((t) => (
              <tr key={t.id} className={t.active ? '' : 'opacity-50'}>
                <td>{t.name}</td><td>{t.slug}</td><td>{t.lots}</td><td>{t.users}</td>
                <td>{t.mp_linked ? 'Vinculado' : '—'}</td><td>{fmtDate(t.created_at)}</td>
                <td className="space-x-2 whitespace-nowrap">
                  <button className="btn-primary" onClick={() => enterTenant(t.id)}>Administrar</button>
                  <button className="text-xs underline" onClick={() => toggle(t)}>{t.active ? 'Suspender' : 'Reactivar'}</button>
                  {crud.actions(t)}
                </td>
              </tr>
            ))}
            {tenants.data?.length === 0 && <tr><td colSpan={7} className="text-slate-500">Todavía no hay complejos.</td></tr>}
          </tbody>
        </table>
      </div>
      {crud.ui}
    </div>
  );
}
