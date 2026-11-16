import { useEffect, useState } from 'react';
import { api, errMsg } from '../lib/api';
import { Alert, Field, PageTitle } from '../components/ui';
import { useFetch } from '../hooks/useFetch';
import { useForm } from '../hooks/useForm';
import { Modal } from '../components/crud';
import { useCrud } from '../hooks/useCrud';
import { opts } from '../lib/format';

const ROLE_LABEL = { owner: 'Propietario', guard: 'Guardia', supervisor: 'Supervisor', admin: 'Administrador', family: 'Familiar', resident: 'Residente' };

export default function AdminUsers() {
  const users = useFetch('/users');
  const lots = useFetch('/lots');
  const uf = useForm({ role: 'owner', full_name: '', email: '', password: '', dni: '', phone: '', lot_id: '' });
  const lf = useForm({ code: '', address: '' });
  const [msg, setMsg] = useState({});
  const [pwdUser, setPwdUser] = useState(null);
  const [lotsUser, setLotsUser] = useState(null);
  const lotOptions = (lots.data || []).map((l) => ({ value: String(l.id), label: l.code }));

  const userCrud = useCrud({
    path: '/users', label: 'usuario', onChange: users.reload,
    fields: [
      { name: 'full_name', label: 'Nombre completo', required: true },
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'role', label: 'Rol', type: 'select', required: true, options: opts(ROLE_LABEL) },
      { name: 'lot_id', label: 'Lote', type: 'select', numeric: true, options: lotOptions },
      { name: 'dni', label: 'DNI' },
      { name: 'phone', label: 'Teléfono' },
      { name: 'password', label: 'Nueva contraseña', type: 'password', minLength: 8 },
      { name: 'active', label: 'Activo', type: 'checkbox' },
    ],
  });
  const lotCrud = useCrud({
    path: '/lots', label: 'lote', onChange: lots.reload,
    fields: [{ name: 'code', label: 'Código', required: true }, { name: 'address', label: 'Dirección' }],
  });

  const createUser = async (e) => {
    e.preventDefault();
    try {
      const body = { ...uf.values, lot_id: uf.values.lot_id ? Number(uf.values.lot_id) : undefined };
      if (!body.dni) { delete body.dni; }
      if (!body.phone) { delete body.phone; }
      await api.post('/users', body);
      uf.reset();
      users.reload();
      setMsg({ ok: 'Usuario creado' });
    } catch (err) {
      setMsg({ error: errMsg(err) });
    }
  };

  const createLot = async (e) => {
    e.preventDefault();
    try {
      await api.post('/lots', lf.values);
      lf.reset();
      lots.reload();
    } catch (err) {
      setMsg({ error: errMsg(err) });
    }
  };

  const toggle = async (u) => {
    await api.patch(`/users/${u.id}`, { active: !u.active });
    users.reload();
  };

  const connectMp = async () => {
    const { data } = await api.get('/pagos/oauth/url');
    window.location.href = data.url;
  };

  return (
    <div className="space-y-6">
      <PageTitle action={<button className="btn-secondary" onClick={connectMp}>Vincular MercadoPago</button>}>Administración</PageTitle>
      <Alert msg={msg.error} />
      <Alert msg={msg.ok} type="ok" />

      <div className="grid gap-4 md:grid-cols-3">
        <form onSubmit={createUser} className="card grid gap-3 md:col-span-2 md:grid-cols-2">
          <h2 className="font-semibold md:col-span-2">Alta de propietario / guardia</h2>
          <Field label="Rol">
            <select className="input" {...uf.bind('role')}>
              <option value="owner">Propietario</option>
              <option value="guard">Guardia</option>
              <option value="supervisor">Supervisor</option>
              <option value="admin">Administrador</option>
            </select>
          </Field>
          <Field label="Lote">
            <select className="input" {...uf.bind('lot_id')} required={uf.values.role === 'owner'}>
              <option value="">—</option>
              {lots.data?.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}
            </select>
          </Field>
          <Field label="Nombre completo"><input className="input" required {...uf.bind('full_name')} /></Field>
          <Field label="Email"><input className="input" type="email" required {...uf.bind('email')} /></Field>
          <Field label="DNI"><input className="input" {...uf.bind('dni')} /></Field>
          <Field label="Teléfono"><input className="input" {...uf.bind('phone')} /></Field>
          <Field label="Contraseña inicial"><input className="input" type="password" minLength={8} required {...uf.bind('password')} /></Field>
          <div className="flex items-end"><button className="btn-primary w-full">Crear usuario</button></div>
        </form>

        <form onSubmit={createLot} className="card space-y-3">
          <h2 className="font-semibold">Nuevo lote</h2>
          <Field label="Código"><input className="input" required {...lf.bind('code')} /></Field>
          <Field label="Dirección"><input className="input" {...lf.bind('address')} /></Field>
          <button className="btn-primary w-full">Agregar lote</button>
        </form>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="mb-2 font-semibold">Lotes ({lots.data?.length ?? 0})</h2>
        <table className="table">
          <thead><tr><th>Código</th><th>Dirección</th><th /></tr></thead>
          <tbody>
            {lots.data?.map((l) => (
              <tr key={l.id}><td>{l.code}</td><td>{l.address || '—'}</td><td className="text-right">{lotCrud.actions(l)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Lote</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {users.data?.map((u) => (
              <tr key={u.id}>
                <td>{u.full_name}</td>
                <td>{u.email}</td>
                <td>{u.roles?.split(',').map((r) => ROLE_LABEL[r] || r).join(', ')}</td>
                <td>{u.lot_code || '—'}{u.extra_lots && <span className="block text-xs text-slate-500">+ {u.extra_lots.split(',').join(', ')}</span>}</td>
                <td>{u.active ? 'Activo' : 'Inactivo'}</td>
                <td className="space-x-2 whitespace-nowrap text-right">
                  <button className="text-xs text-brand-700 underline" onClick={() => toggle(u)}>{u.active ? 'Desactivar' : 'Activar'}</button>
                  <button className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100" onClick={() => setPwdUser(u)}>Cambiar clave</button>
                  {u.roles?.split(',').includes('owner') && (
                    <button className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100" onClick={() => setLotsUser(u)}>Lotes</button>
                  )}
                  {userCrud.actions({ ...u, role: u.roles?.split(',')[0] })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {userCrud.ui}
      {lotsUser && <OwnerLotsModal user={lotsUser} lots={lots.data || []} onClose={() => setLotsUser(null)}
        onDone={(m) => { setLotsUser(null); users.reload(); setMsg({ ok: m }); }} />}
      {pwdUser && <PasswordModal user={pwdUser} onClose={() => setPwdUser(null)} onDone={(m) => { setPwdUser(null); setMsg({ ok: m }); }} />}
      {lotCrud.ui}
    </div>
  );
}

function PasswordModal({ user, onClose, onDone }) {
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (pwd !== pwd2) { return setError('Las contraseñas no coinciden'); }
    setBusy(true);
    setError('');
    try {
      await api.post(`/users/${user.id}/password`, { password: pwd });
      onDone(`Contraseña de ${user.full_name} actualizada`);
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={`Cambiar clave · ${user.full_name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-slate-500">{user.email}</p>
        <Alert msg={error} />
        <Field label="Nueva contraseña (mín. 8)">
          <input className="input" type={show ? 'text' : 'password'} minLength={8} required autoComplete="new-password"
            value={pwd} onChange={(e) => setPwd(e.target.value)} />
        </Field>
        <Field label="Repetir contraseña">
          <input className="input" type={show ? 'text' : 'password'} minLength={8} required autoComplete="new-password"
            value={pwd2} onChange={(e) => setPwd2(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Mostrar
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar clave'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Lotes de un propietario: el principal siempre queda; se pueden sumar otros (expensas de todos sus lotes). */
function OwnerLotsModal({ user, lots, onClose, onDone }) {
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get(`/users/${user.id}/lots`).then((r) => setSelected(new Set(r.data.lot_ids))).catch((e) => setError(errMsg(e)));
  }, [user.id]);
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) { n.delete(id); } else { n.add(id); } return n; });
  const save = async () => {
    try {
      await api.put(`/users/${user.id}/lots`, { lot_ids: [...selected] });
      onDone(`Lotes de ${user.full_name} actualizados`);
    } catch (e) { setError(errMsg(e)); }
  };
  return (
    <Modal title={`Lotes de ${user.full_name}`} onClose={onClose}>
      <Alert msg={error} />
      {!selected ? <p className="text-sm text-slate-500">Cargando…</p> : (
        <>
          <p className="mb-3 text-xs text-slate-500">El lote principal ({user.lot_code || '—'}) se usa para accesos, visitas y reservas y no se puede quitar desde acá.</p>
          <ul className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
            {lots.map((l) => {
              const primary = l.id === user.lot_id;
              return (
                <li key={l.id}>
                  <label className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${selected.has(l.id) ? 'border-brand-600 bg-brand-50 dark:bg-brand-900/20' : 'border-slate-200 dark:border-slate-700'}`}>
                    <input type="checkbox" checked={selected.has(l.id) || primary} disabled={primary} onChange={() => toggle(l.id)} />
                    {l.code}{primary && <span className="text-[10px] text-slate-500">principal</span>}
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="button" className="btn-primary" onClick={save}>Guardar</button>
          </div>
        </>
      )}
    </Modal>
  );
}
