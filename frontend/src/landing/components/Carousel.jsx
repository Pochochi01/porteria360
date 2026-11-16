import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { Icon } from '../../components/icons';
import { ResponsiveImage } from '../../components/ResponsiveImage';

const AUTOPLAY_MS = 5500;
const wrap = (i, n) => ((i % n) + n) % n;
/** Desplazamiento relativo más corto en un loop de n elementos (…-2,-1,0,1,2…). */
const offsetOf = (i, index, n) => {
  let d = wrap(i - index, n);
  if (d > n / 2) { d -= n; }
  return d;
};

/**
 * Carousel infinito con autoplay, drag/touch y teclado.
 * @param {{ slides: { asset: string, category: string, name: string, location: string, lots: number, amenities: string[], unitsLabel?: string }[] }} props
 */
export function Carousel({ slides }) {
  const n = slides.length;
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const trackRef = useRef(null);
  const drag = useRef(null);
  const prevOffsets = useRef({});

  const go = useCallback((d) => setIndex((i) => wrap(i + d, n)), [n]);

  // Autoplay: se pausa con hover, foco, pestaña oculta o "reducir movimiento"
  useEffect(() => {
    if (paused || reduce) { return; }
    const t = setInterval(() => { if (!document.hidden) { go(1); } }, AUTOPLAY_MS);
    return () => clearInterval(t);
  }, [paused, reduce, go, index]);

  const onPointerDown = (e) => {
    if (drag.current || (e.pointerType === 'mouse' && e.button !== 0)) { return; } // ignora un segundo dedo
    drag.current = { x: e.clientX, y: e.clientY, t: performance.now(), dx: 0, id: e.pointerId, horizontal: null };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) { return; }
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (d.horizontal === null && Math.abs(dx) + Math.abs(dy) > 6) {
      d.horizontal = Math.abs(dx) > Math.abs(dy); // si es vertical, deja scrollear la página
      if (d.horizontal) { e.currentTarget.setPointerCapture(e.pointerId); }
    }
    if (!d.horizontal) { return; }
    d.dx = dx;
    trackRef.current.style.transition = 'none';
    trackRef.current.style.transform = `translate3d(${dx}px,0,0)`;
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.horizontal) { return; }
    const width = trackRef.current.offsetWidth;
    const velocity = Math.abs(d.dx) / (performance.now() - d.t);
    trackRef.current.style.transition = 'transform 500ms cubic-bezier(0.23, 1, 0.32, 1)';
    trackRef.current.style.transform = '';
    if (Math.abs(d.dx) > width * 0.12 || velocity > 0.11) { go(d.dx < 0 ? 1 : -1); }
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const onKey = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  };

  return (
    <div role="region" aria-roledescription="carrusel" aria-label="Comunidades destacadas" tabIndex={0} onKeyDown={onKey}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      className="relative rounded-3xl">
      <div className="relative h-[440px] select-none overflow-hidden sm:h-[520px]" style={{ touchAction: 'pan-y' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <div ref={trackRef} className="absolute inset-0">
          {slides.map((s, i) => {
            const off = offsetOf(i, index, n);
            // Si un slide "salta" de un extremo al otro del loop, se mueve sin transición (fuera de vista)
            const jumped = Math.abs(off - (prevOffsets.current[i] ?? off)) > 1;
            prevOffsets.current[i] = off;
            const active = off === 0;
            return (
              <div key={s.name} aria-roledescription="diapositiva" aria-label={`${i + 1} de ${n}: ${s.name}`} aria-hidden={!active}
                className="absolute inset-y-0 left-1/2 w-[86%] sm:w-[72%] lg:w-[64%]"
                style={{
                  transform: `translate3d(calc(-50% + ${off} * (100% + 20px)), 0, 0) scale(${active ? 1 : 0.9})`,
                  opacity: Math.abs(off) > 1 ? 0 : active ? 1 : 0.45,
                  transition: jumped || reduce ? 'none' : 'transform 700ms cubic-bezier(0.23, 1, 0.32, 1), opacity 500ms ease',
                  zIndex: active ? 2 : 1,
                }}>
                <article className="relative h-full overflow-hidden rounded-3xl shadow-2xl shadow-slate-900/20 dark:shadow-black/50">
                  <ResponsiveImage id={s.asset} variant="day" fill sizes="(min-width: 1024px) 64vw, 86vw" className="absolute inset-0 h-full w-full"
                    imgClassName={`transition-transform duration-[1400ms] ease-out ${active ? 'scale-100' : 'scale-110'}`} />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/20 to-transparent" />
                  <div className={`glass absolute inset-x-3 bottom-3 rounded-2xl p-4 transition-[opacity,transform] duration-500 ease-out sm:inset-x-5 sm:bottom-5 sm:p-5 ${
                    active ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
                    <span className="inline-block rounded-full bg-brand-700 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-on">{s.category}</span>
                    <h3 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl dark:text-white">{s.name}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
                      <span className="flex items-center gap-1"><Icon name="pin" className="h-4 w-4" />{s.location}</span>
                      <span className="flex items-center gap-1"><Icon name="grid" className="h-4 w-4" />{s.lots.toLocaleString('es-AR')} {s.unitsLabel || 'lotes'}</span>
                    </div>
                    <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Amenities">
                      {s.amenities.map((a) => <li key={a} className="rounded-full border border-slate-300/70 px-2 py-0.5 text-xs text-slate-700 dark:border-white/15 dark:text-slate-300">{a}</li>)}
                    </ul>
                  </div>
                </article>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-center gap-4">
        <button type="button" onClick={() => go(-1)} aria-label="Anterior" className="grid h-10 w-10 place-items-center rounded-full border border-slate-300 bg-white text-slate-700 transition-transform duration-150 ease-out active:scale-95 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
          <Icon name="chevronLeft" />
        </button>
        <div className="flex gap-2" role="tablist" aria-label="Elegir comunidad">
          {slides.map((s, i) => (
            <button key={s.name} type="button" role="tab" aria-selected={i === index} aria-label={s.name} onClick={() => setIndex(i)}
              className="grid h-6 min-w-6 place-items-center px-1">
              <span className={`block h-1.5 rounded-full transition-[width,background-color] duration-300 ease-out ${i === index ? 'w-7 bg-brand-600 dark:bg-brand-400' : 'w-1.5 bg-slate-300 dark:bg-slate-600'}`} />
            </button>
          ))}
        </div>
        <button type="button" onClick={() => go(1)} aria-label="Siguiente" className="grid h-10 w-10 place-items-center rounded-full border border-slate-300 bg-white text-slate-700 transition-transform duration-150 ease-out active:scale-95 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
          <Icon name="chevronRight" />
        </button>
      </div>
    </div>
  );
}
