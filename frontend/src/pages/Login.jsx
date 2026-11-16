import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { errMsg } from '../lib/api';
import { Alert, Field } from '../components/ui';
import { useForm } from '../hooks/useForm';

export default function Login() {
  const { login } = useAuth();
  const [params] = useSearchParams();
  const { values, bind } = useForm({ tenant: params.get('tenant') || localStorage.getItem('tenant') || '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      localStorage.setItem('tenant', values.tenant);
      await login(values.tenant, values.email, values.password);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-700 to-brand-950 dark:from-slate-900 dark:to-slate-950 p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-3">
        <h1 className="text-center text-2xl font-bold text-brand-800 dark:text-white">AdminCountrys</h1>
        <Alert msg={error} />
        <Field label="Complejo (vacío para administrador de plataforma)"><input className="input" {...bind('tenant')} placeholder="mi-country" /></Field>
        <Field label="Email"><input className="input" type="email" required autoComplete="username" {...bind('email')} /></Field>
        <Field label="Contraseña"><input className="input" type="password" required autoComplete="current-password" {...bind('password')} /></Field>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
        <Link to="/" className="block text-center text-xs text-slate-500 hover:underline">← Volver al inicio</Link>
      </form>
    </div>
  );
}
