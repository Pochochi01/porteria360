import { Icon } from '../../components/icons';
import { TiltCard } from '../../components/TiltCard';
import { Reveal } from './Section';

/**
 * Grilla de tarjetas con ícono, revelado escalonado y tilt 3D (reutilizada por Beneficios y Funcionalidades).
 * @param {{ items: { icon: string, title: string, text: string }[], columns?: string, variant?: 'glass' | 'solid' }} props
 */
export function CardGrid({ items, columns = 'sm:grid-cols-2 lg:grid-cols-3', variant = 'glass' }) {
  return (
    <ul className={`grid gap-4 ${columns}`}>
      {items.map((it, i) => (
        <Reveal as="li" key={it.title} index={i % 6} className="h-full">
          <TiltCard max={6}
            className={`group h-full rounded-2xl p-5 shadow-sm transition-shadow duration-300 hover:shadow-xl hover:shadow-brand-900/10 ${
              variant === 'glass' ? 'glass-lite' : 'border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900'}`}>
            <span className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand-500/15 to-brand-700/10 text-brand-700 ring-1 ring-inset ring-brand-600/15 dark:from-brand-400/20 dark:to-brand-600/10 dark:text-brand-300 dark:ring-brand-400/20">
              <Icon name={it.icon} />
            </span>
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">{it.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{it.text}</p>
          </TiltCard>
        </Reveal>
      ))}
    </ul>
  );
}
