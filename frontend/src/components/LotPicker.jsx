import { useEffect, useId, useRef, useState } from 'react';
import { api, errMsg } from '../lib/api';
import { Icon } from './icons';

/** @typedef {{ id: number, code: string, address?: string|null, holder?: string|null, family?: string|null }} Lot */

const DEBOUNCE_MS = 250;

/**
 * Buscador de lote destino (combobox accesible): por número, titular o apellido del grupo familiar.
 * La búsqueda es del servidor (paginada), así funciona igual con 20 o con 5.000 lotes.
 * @param {{ value: Lot | null, onChange: (lot: Lot | null) => void, label?: string, required?: boolean }} props
 */
export function LotPicker({ value, onChange, label = 'Lote destino', required = false }) {
  const id = useId();
  const inputRef = useRef(null);
  const reqId = useRef(0);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(-1);

  const load = async (text, p) => {
    const mine = ++reqId.current; // descarta respuestas viejas si el guardia sigue escribiendo
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/lots/search', { params: { q: text, page: p } });
      if (mine !== reqId.current) { return; }
      setItems((prev) => (p ? [...prev, ...data.items] : data.items));
      setHasMore(data.hasMore);
      setPage(p);
      if (!p) { setActive(data.items.length ? 0 : -1); }
    } catch (e) {
      if (mine === reqId.current) { setError(errMsg(e)); }
    } finally {
      if (mine === reqId.current) { setLoading(false); }
    }
  };

  useEffect(() => {
    if (!open) { return undefined; }
    const t = setTimeout(() => load(q, 0), q ? DEBOUNCE_MS : 0);
    return () => clearTimeout(t);
  }, [q, open]); // load usa solo setters y refs: no hace falta como dependencia

  const pick = (lot) => {
    onChange(lot);
    setOpen(false);
    setQ('');
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, items.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === 'Enter' && open && items[active]) { e.preventDefault(); pick(items[active]); }
    if (e.key === 'Escape') { setOpen(false); }
  };

  if (value) {
    return (
      <div>
        <span className="label">{label}</span>
        <div className="flex items-center gap-3 rounded-lg border border-brand-600 bg-brand-50 px-3 py-2 dark:bg-brand-500/10">
          <Icon name="home" className="h-5 w-5 shrink-0 text-brand-700 dark:text-brand-300" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Lote {value.code}</div>
            <div className="truncate text-xs text-slate-600 dark:text-slate-300">{value.family || 'Sin residentes cargados'}</div>
          </div>
          <button type="button" className="btn-secondary !px-3" onClick={() => { onChange(null); requestAnimationFrame(() => inputRef.current?.focus()); }}>Cambiar</button>
        </div>
      </div>
    );
  }

  const listId = `${id}-list`;
  return (
    <div className="relative">
      <label htmlFor={`${id}-input`} className="label">{label}</label>
      <div className="relative">
        <Icon name="home" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input ref={inputRef} id={`${id}-input`} className="input !pl-9" type="search" autoComplete="off" required={required}
          placeholder="Número de lote, titular o familia" value={q}
          role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${id}-opt-${active}` : undefined}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
          onBlur={() => setTimeout(() => setOpen(false), 150)} />
      </div>
      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-[min(22rem,55dvh)] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <ul id={listId} role="listbox" aria-label="Lotes">
            {items.map((l, i) => (
              <li key={l.id} id={`${id}-opt-${i}`} role="option" aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()} onClick={() => pick(l)} onMouseEnter={() => setActive(i)}
                className={`flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 ${i === active ? 'bg-brand-50 dark:bg-brand-500/10' : ''}`}>
                <span className="w-16 shrink-0 font-semibold tabular-nums">{l.code}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{l.holder || <span className="text-slate-400">Sin titular cargado</span>}</span>
                  {l.family && l.family !== l.holder && <span className="block truncate text-xs text-slate-500">{l.family}</span>}
                </span>
              </li>
            ))}
          </ul>
          {!loading && !items.length && !error && <p className="px-3 py-4 text-center text-sm text-slate-500">{q ? 'Sin resultados' : 'No hay lotes cargados'}</p>}
          {error && <p role="alert" className="px-3 py-3 text-sm text-red-600">{error}</p>}
          {loading && <p role="status" className="px-3 py-3 text-center text-sm text-slate-500">Buscando…</p>}
          {hasMore && !loading && (
            <button type="button" className="w-full border-t border-slate-100 py-3 text-sm font-medium text-brand-700 dark:border-slate-800 dark:text-brand-300"
              onMouseDown={(e) => e.preventDefault()} onClick={() => load(q, page + 1)}>
              Ver más lotes
            </button>
          )}
        </div>
      )}
    </div>
  );
}
