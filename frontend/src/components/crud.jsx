import { useId, useState } from 'react';
import { errMsg } from '../lib/api';
import { Alert, Field } from './ui';

/** @param {{ title: string, onClose: () => void, children: any, wide?: boolean }} props wide: para documentos y tablas */
export function Modal({ title, onClose, children, wide = false }) {
  const titleId = useId();
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-[2px] p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className={`max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl dark:bg-slate-900 sm:rounded-2xl ${wide ? 'sm:max-w-4xl' : 'sm:max-w-lg'}`}
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Cerrar">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Conversión entre valores de MySQL y valores de inputs
const toInput = (f, v) => {
  if (v == null) { return f.type === 'checkbox' ? false : ''; }
  if (f.type === 'checkbox') { return !!Number(v) || v === true; }
  if (f.type === 'datetime') { return String(v).replace(' ', 'T').slice(0, 16); }
  if (f.type === 'time') { return String(v).slice(0, 5); }
  if (f.type === 'date') { return String(v).slice(0, 10); }
  return String(v);
};
const fromInput = (f, v) => {
  if (f.type === 'checkbox') { return !!v; }
  if (v === '' || v == null) { return f.type === 'password' ? undefined : null; }
  if (f.type === 'number' || f.numeric) { return Number(v); }
  return v;
};

/**
 * Formulario de edición genérico.
 * fields: [{ name, label, type: text|email|number|password|date|datetime|time|select|checkbox|textarea, options, required, numeric }]
 */
export function EditModal({ title, fields, row, onSave, onClose }) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.name, toInput(f, row[f.name])])));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (name, v) => setValues((s) => ({ ...s, [name]: v }));

  const submit = async (e) => {
    e.preventDefault();
    // Solo se envían los campos modificados
    const payload = {};
    for (const f of fields) {
      if (values[f.name] === toInput(f, row[f.name])) { continue; }
      const v = fromInput(f, values[f.name]);
      if (v !== undefined) { payload[f.name] = v; }
    }
    if (!Object.keys(payload).length) { return onClose(); }
    setBusy(true);
    setError('');
    try {
      await onSave(payload);
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Alert msg={error} />
        {fields.map((f) =>
          f.type === 'checkbox' ? (
            <label key={f.name} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={values[f.name]} onChange={(e) => set(f.name, e.target.checked)} /> {f.label}
            </label>
          ) : (
            <Field key={f.name} label={f.label}>
              {f.type === 'select' ? (
                <select className="input" required={f.required} value={values[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                  {!f.required && <option value="">—</option>}
                  {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea className="input" rows={3} value={values[f.name]} onChange={(e) => set(f.name, e.target.value)} />
              ) : (
                <input className="input" required={f.required} minLength={f.minLength} step={f.step}
                  type={f.type === 'datetime' ? 'datetime-local' : f.type || 'text'}
                  placeholder={f.type === 'password' ? 'Dejar vacío para no cambiar' : undefined}
                  value={values[f.name]} onChange={(e) => set(f.name, e.target.value)} />
              )}
            </Field>
          )
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Confirmación de borrado definitivo; si el backend informa dependencias, pide una segunda confirmación. */
export function ConfirmDelete({ state, onConfirm, onClose }) {
  const { deps, blocked, error, busy } = state;
  return (
    <Modal title="Eliminar definitivamente" onClose={onClose}>
      <Alert msg={error} />
      {!deps && <p className="text-sm">¿Seguro que deseas eliminar este registro definitivamente? Esta acción no se puede deshacer.</p>}
      {deps && (
        <div className="space-y-2 text-sm">
          <p>{blocked ? 'No se puede eliminar porque tiene:' : 'Este registro tiene datos relacionados que también se eliminarán:'}</p>
          <ul className="list-disc pl-6">
            {deps.map((d) => <li key={d.label} className={d.block ? 'font-semibold text-red-700' : ''}>{d.count} {d.label}</li>)}
          </ul>
          {!blocked && <p className="font-medium text-red-700">¿Eliminar todo definitivamente?</p>}
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>{blocked ? 'Cerrar' : 'Cancelar'}</button>
        {!blocked && <button className="btn-danger" disabled={busy} onClick={onConfirm}>{busy ? 'Eliminando…' : deps ? 'Eliminar todo' : 'Eliminar'}</button>}
      </div>
    </Modal>
  );
}
