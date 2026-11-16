import { useReveal } from '../../hooks/useReveal';

/**
 * Sección con encabezado revelado al hacer scroll.
 * @param {{ id?: string, eyebrow?: string, title: string, subtitle?: string, children: any, className?: string, align?: 'center' | 'left' }} props
 */
export function Section({ id, eyebrow, title, subtitle, children, className = '', align = 'center' }) {
  const head = useReveal({ blur: true });
  const centered = align === 'center';
  return (
    <section id={id} className={`defer-render relative scroll-mt-20 px-4 py-20 sm:px-6 sm:py-28 ${className}`} aria-labelledby={id && `${id}-title`}>
      <div className="mx-auto max-w-6xl">
        <div ref={head.ref} className={`${head.className} mb-12 sm:mb-16 ${centered ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}`} style={head.style}>
          {eyebrow && <p className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-400">{eyebrow}</p>}
          <h2 id={id && `${id}-title`} className="text-balance font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">{title}</h2>
          {subtitle && <p className="text-pretty mt-4 text-lg leading-relaxed text-slate-600 dark:text-slate-400">{subtitle}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

/** Envuelve hijos con revelado escalonado. */
export function Reveal({ index = 0, blur = false, as: Tag = 'div', className = '', children, ...rest }) {
  const r = useReveal({ index, blur });
  return <Tag ref={r.ref} className={`${r.className} ${className}`} style={r.style} {...rest}>{children}</Tag>;
}
