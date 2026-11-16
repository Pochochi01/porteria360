import { useRef } from 'react';

/**
 * Pestañas accesibles (flechas ←/→ para moverse). El contenido lo renderiza el padre según `value`.
 * @param {{ tabs: { id: string, label: string, badge?: number }[], value: string, onChange: (id: string) => void, label: string }} props
 */
export function Tabs({ tabs, value, onChange, label }) {
  const refs = useRef([]);
  const onKey = (e, i) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) { return; }
    e.preventDefault();
    const next = (i + d + tabs.length) % tabs.length;
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="no-scrollbar -mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 dark:border-slate-800">
      {tabs.map((t, i) => (
        <button key={t.id} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={`tab-${t.id}`}
          aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1} onClick={() => onChange(t.id)} onKeyDown={(e) => onKey(e, i)}
          className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
            value === t.id ? 'border-brand-600 text-brand-800 dark:border-brand-400 dark:text-brand-300' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>
          {t.label}
          {t.badge ? <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}
