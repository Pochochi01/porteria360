import { useState } from 'react';
import { api, errMsg } from '../lib/api';
import { Alert, Field, PageTitle } from '../components/ui';
import { useFetch } from '../hooks/useFetch';
import { useForm } from '../hooks/useForm';
import { useCrud } from '../hooks/useCrud';

export default function Household() {
  const list = useFetch('/household');
  const f = useForm({ role: 'family', full_name: '', email: '', password: '', dni: '', phone: '' });
  const [error, setError] = useState('');
  const crud = useCrud({
    path: '/household', label: 'familiar', onChange: list.reload,
    fields: [
      { name: 'full_name', label: 'Nombre completo', required: true },
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'role', label: 'Tipo', type: 'select', required: true, options: [{ value: 'family', label: 'Familiar' }, { value: 'resident', label: 'Residente' }] },
      { name: 'dni', label: 'DNI' },
      { name: 'phone', label: 'Teléfono' },
      { name: 'password', label: 'Nueva contraseña', type: 'password', minLength: 8 },
    ],
  });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const body = { ...f.values };
      if (!body.dni) { delete body.dni; }
      if (!body.phone) { delete body.phone; }
      await api.post('/household', body);
      f.reset();
      list.reload();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const toggle = async (u) => {
    await api.patch(`/household/${u.id}`, { active: !u.active });
    list.reload();
  };

  return (
    <div className="space-y-4">
      <PageTitle>Mi familia y residentes</PageTitle>
      <form onSubmit={submit} className="card grid gap-3 md:grid-cols-3">
        <Alert msg={error} />
        <Field label="Tipo">
          <select className="input" {...f.bind('role')}>
            <option value="family">Familiar</option>
            <option value="resident">Residente habilitado (inquilino, etc.)</option>
          </select>
        </Field>
        <Field label="Nombre completo"><input className="input" required {...f.bind('full_name')} /></Field>
        <Field label="Email"><input className="input" type="email" required {...f.bind('email')} /></Field>
        <Field label="DNI"><input className="input" {...f.bind('dni')} /></Field>
        <Field label="Teléfono"><input className="input" {...f.bind('phone')} /></Field>
        <Field label="Contraseña"><input className="input" type="password" minLength={8} required {...f.bind('password')} /></Field>
        <button className="btn-primary md:col-start-3">Agregar</button>
      </form>
      <div className="grid gap-3 md:grid-cols-2">
        {list.data?.map((u) => (
          <div key={u.id} className="card flex items-center justify-between">
            <div>
              <div className="font-medium">{u.full_name}</div>
              <div className="text-xs text-slate-500">{u.email} · {u.roles === 'family' ? 'Familiar' : 'Residente'}</div>
            </div>
            <span className="flex items-center gap-2">
              {crud.actions({ ...u, role: u.roles })}
              <button className={u.active ? 'btn-secondary' : 'btn-primary'} onClick={() => toggle(u)}>
                {u.active ? 'Inhabilitar' : 'Habilitar'}
              </button>
            </span>
          </div>
        ))}
        {list.data?.length === 0 && <p className="text-sm text-slate-500">Todavía no agregaste a nadie.</p>}
      </div>
      {crud.ui}
    </div>
  );
}
