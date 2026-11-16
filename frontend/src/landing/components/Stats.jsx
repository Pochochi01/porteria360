import { useInViewOnce } from '../../hooks/useReveal';
import { useCountUp } from '../../hooks/useCountUp';

const fmt = (n) => n.toLocaleString('es-AR');

function Stat({ value, suffix, label, start }) {
  const v = useCountUp(value, start);
  return (
    <div className="text-center">
      <dd className="font-display text-4xl font-extrabold tracking-tight text-slate-900 tabular-nums sm:text-5xl dark:text-white">
        {fmt(v)}<span className="text-brand-600 dark:text-brand-400">{suffix}</span>
      </dd>
      <dt className="mt-2 text-sm text-slate-600 dark:text-slate-400">{label}</dt>
    </div>
  );
}

/** Contadores animados que arrancan al entrar en el viewport. */
export function Stats({ items }) {
  const [ref, inView] = useInViewOnce();
  return (
    <div ref={ref}>
      {/* Para lectores de pantalla, los valores finales sin animación */}
      <dl className="grid grid-cols-2 gap-y-12 lg:grid-cols-4" aria-hidden="true">
        {items.map((s) => <Stat key={s.label} {...s} start={inView} />)}
      </dl>
      <ul className="sr-only">{items.map((s) => <li key={s.label}>{fmt(s.value)}{s.suffix} {s.label}</li>)}</ul>
      <p className="mt-10 text-center text-xs text-slate-500">Cifras de ejemplo.</p>
    </div>
  );
}
