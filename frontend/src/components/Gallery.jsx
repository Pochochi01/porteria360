import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { Icon } from './icons';

/**
 * @typedef {{ key: string, title?: string, tags: string[], src: string, srcSet?: string, width?: number, height?: number,
 *             alt: string, placeholder?: string, caption?: string }} GalleryItem
 */

/** Lightbox accesible: Esc, flechas, foco atrapado en el diálogo y foco devuelto al cerrar. */
export function Lightbox({ items, index, onClose, onIndex }) {
  const closeRef = useRef(null);
  const item = items[index];
  const go = useCallback((d) => onIndex((index + d + items.length) % items.length), [index, items.length, onIndex]);

  useEffect(() => {
    const prev = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => { document.body.style.overflow = overflow; prev?.focus?.(); };
  }, []);
  useEffect(() => {
    const on = (e) => {
      if (e.key === 'Escape') { onClose(); }
      if (e.key === 'ArrowRight') { go(1); }
      if (e.key === 'ArrowLeft') { go(-1); }
      if (e.key === 'Tab') { // foco atrapado en los 3 botones
        const f = [...document.querySelectorAll('[data-lightbox-focus]')];
        const i = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [go, onClose]);

  return (
    <m.div role="dialog" aria-modal="true" aria-label={item.title || item.alt}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} transition={{ duration: 0.25 }}
      className="fixed inset-0 z-50 flex flex-col bg-slate-950/90 p-3 backdrop-blur-sm sm:p-6" onClick={onClose}>
      <div className="flex items-center justify-between gap-3 text-white" onClick={(e) => e.stopPropagation()}>
        <p className="truncate text-sm font-medium">{item.title}{item.caption && <span className="ml-2 text-white/60">{item.caption}</span>}</p>
        <span className="flex items-center gap-3">
          <span className="text-xs tabular-nums text-white/60">{index + 1} / {items.length}</span>
          <button ref={closeRef} data-lightbox-focus type="button" onClick={onClose} aria-label="Cerrar"
            className="grid h-10 w-10 place-items-center rounded-full bg-white/10 transition-transform duration-150 ease-out hover:bg-white/20 active:scale-95"><Icon name="x" /></button>
        </span>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center py-3">
        <AnimatePresence mode="popLayout" initial={false}>
          <m.img key={item.key} src={item.src} srcSet={item.srcSet} sizes="100vw" alt={item.alt}
            initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded-xl object-contain shadow-2xl" />
        </AnimatePresence>
      </div>
      {items.length > 1 && (
        <div className="flex justify-center gap-3" onClick={(e) => e.stopPropagation()}>
          <button data-lightbox-focus type="button" onClick={() => go(-1)} aria-label="Imagen anterior"
            className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 active:scale-95"><Icon name="chevronLeft" /></button>
          <button data-lightbox-focus type="button" onClick={() => go(1)} aria-label="Imagen siguiente"
            className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 active:scale-95"><Icon name="chevronRight" /></button>
        </div>
      )}
    </m.div>
  );
}

/**
 * Galería masonry con filtros, zoom al pasar el mouse, lazy loading y lightbox.
 * @param {{ items: GalleryItem[], filters?: { id: string, label: string }[], emptyText?: string }} props
 */
export function Gallery({ items, filters, emptyText = 'No hay imágenes en esta categoría.' }) {
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(null);
  const shown = filter === 'all' ? items : items.filter((it) => it.tags.includes(filter));

  return (
    <div>
      {filters && (
        <div role="tablist" aria-label="Filtrar galería" className="no-scrollbar -mx-4 mb-8 flex justify-start gap-2 overflow-x-auto px-4 sm:justify-center">
          {filters.map((f) => {
            const count = f.id === 'all' ? items.length : items.filter((it) => it.tags.includes(f.id)).length;
            return (
              <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-[background-color,color,transform] duration-200 ease-out active:scale-[0.97] ${
                  filter === f.id ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-white text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-100 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10 dark:hover:bg-white/10'}`}>
                {f.label} <span className="ml-1 tabular-nums opacity-75">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {shown.length ? (
        <ul className="columns-1 gap-4 sm:columns-2 lg:columns-3" key={filter}>
          {shown.map((it, i) => (
            <li key={it.key} className="mb-4 break-inside-avoid animate-[fadeUp_500ms_cubic-bezier(0.23,1,0.32,1)_both]" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
              <button type="button" onClick={() => setOpen(items.indexOf(it))}
                className="group relative block w-full overflow-hidden rounded-2xl bg-slate-200 text-left dark:bg-slate-800"
                aria-label={`Ampliar: ${it.title || it.alt}`}>
                <img src={it.src} srcSet={it.srcSet} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" alt={it.alt}
                  width={it.width} height={it.height} loading="lazy" decoding="async"
                  style={it.placeholder ? { backgroundImage: `url(${it.placeholder})`, backgroundSize: 'cover' } : undefined}
                  className="h-auto w-full transition-transform duration-700 ease-out group-hover:scale-[1.06] motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
                <span className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100" />
                <span className="absolute inset-x-3 bottom-3 flex translate-y-2 items-center justify-between text-sm font-medium text-white opacity-0 transition-[opacity,transform] duration-300 ease-out group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
                  <span className="truncate">{it.title}{it.caption && <span className="ml-1.5 text-white/70">· {it.caption}</span>}</span>
                  <Icon name="external" className="h-4 w-4 shrink-0" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-10 text-center text-slate-500">{emptyText}</p>
      )}

      <AnimatePresence>
        {open !== null && <Lightbox items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
      </AnimatePresence>
    </div>
  );
}
