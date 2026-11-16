import { useEffect, useRef, useState } from 'react';
import { m } from 'motion/react';
import { api, errMsg } from '../../lib/api';
import { Icon } from '../../components/icons';

const KINDS = [['country', 'Country'], ['barrio', 'Barrio privado'], ['edificio', 'Edificio / torre'], ['otro', 'Otro']];

/** Formulario "Solicitar demo" (POST /api/public/demo-requests). */
export function DemoModal({ onClose }) {
  const first = useRef(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', organization: '', kind: 'country', units: '', message: '', website: '' });
  const [state, setState] = useState({ busy: false, error: '', done: false });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    const prev = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    first.current?.focus();
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', esc); prev?.focus?.(); };
  }, [onClose]);

  const submit = async (e) => {
    e.preventDefault();
    setState({ busy: true, error: '', done: false });
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ''));
    if (body.units) { body.units = Number(body.units); }
    try {
      await api.post('/public/demo-requests', body);
      setState({ busy: false, error: '', done: true });
    } catch (err) {
      setState({ busy: false, error: errMsg(err), done: false });
    }
  };

  return (
    <m.div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 backdrop-blur-sm sm:items-center sm:p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} onMouseDown={onClose}>
      <m.div role="dialog" aria-modal="true" aria-labelledby="demo-title" onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, transition: { duration: 0.15 } }}
        transition={{ type: 'spring', duration: 0.45, bounce: 0.12 }}
        className="pb-safe max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:max-w-lg sm:rounded-3xl sm:p-8 dark:bg-slate-900">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="demo-title" className="font-display text-2xl font-bold text-slate-900 dark:text-white">Solicitar demo</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Te contactamos en menos de 24 h hábiles para mostrarte la plataforma.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-slate-100 dark:hover:bg-white/10"><Icon name="x" /></button>
        </div>

        {state.done ? (
          <div className="py-8 text-center" role="status">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-500/15 text-emerald-600"><Icon name="check" className="h-7 w-7" strokeWidth={2.5} /></span>
            <p className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">¡Gracias, {form.name.split(' ')[0]}!</p>
            <p className="mt-1 text-slate-600 dark:text-slate-400">Recibimos tu pedido. Te escribimos a {form.email}.</p>
            <button type="button" onClick={onClose} className="btn-primary mt-6">Listo</button>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" noValidate={false}>
            {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2 dark:bg-red-950/50 dark:text-red-300">{state.error}</p>}
            <label className="sm:col-span-2"><span className="label">Nombre y apellido</span>
              <input ref={first} className="input" required autoComplete="name" value={form.name} onChange={set('name')} /></label>
            <label><span className="label">Email</span><input className="input" type="email" required autoComplete="email" value={form.email} onChange={set('email')} /></label>
            <label><span className="label">Teléfono</span><input className="input" type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} /></label>
            <label className="sm:col-span-2"><span className="label">Comunidad o empresa</span><input className="input" autoComplete="organization" value={form.organization} onChange={set('organization')} /></label>
            <label><span className="label">Tipo</span>
              <select className="input" value={form.kind} onChange={set('kind')}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label><span className="label">Lotes / unidades</span><input className="input" type="number" min="1" inputMode="numeric" value={form.units} onChange={set('units')} /></label>
            <label className="sm:col-span-2"><span className="label">¿Qué te gustaría resolver?</span>
              <textarea className="input" rows={3} maxLength={1000} value={form.message} onChange={set('message')} /></label>
            {/* Honeypot anti-spam: oculto para personas */}
            <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={form.website} onChange={set('website')} />
            <button className="btn-primary h-11 sm:col-span-2" disabled={state.busy}>{state.busy ? 'Enviando…' : 'Solicitar demo'}</button>
          </form>
        )}
      </m.div>
    </m.div>
  );
}
