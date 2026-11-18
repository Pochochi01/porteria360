import { useId, useState } from 'react';
import { Icon } from './icons';

/**
 * Sección desplegable accesible (botón con aria-expanded). Cerrada, el contenido queda fuera del
 * orden de tabulación (inert) y no ocupa espacio. La altura se anima con grid-rows 0fr → 1fr.
 * @param {{ title: string, count?: number, countLabel?: string, defaultOpen?: boolean, children: any, className?: string }} props
 */
export function Collapsible({ title, count = 0, countLabel, defaultOpen = false, children, className = '' }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className={`card !p-0 ${className}`}>
      <h2>
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
          className="flex min-h-14 w-full items-center gap-3 rounded-xl px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50">
          <span className="flex-1 font-semibold">{title}</span>
          {count > 0 && (
            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white" aria-label={countLabel ? `${count} ${countLabel}` : undefined}>
              {count}
            </span>
          )}
          <Icon name="down" className={`h-5 w-5 shrink-0 text-slate-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
      </h2>
      <div id={id} inert={open ? undefined : ''}
        className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-slate-100 p-4 dark:border-slate-800">{children}</div>
        </div>
      </div>
    </section>
  );
}
