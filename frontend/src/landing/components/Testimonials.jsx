import { Icon } from '../../components/icons';
import { Reveal } from './Section';

const initials = (name) => name.split(' ').map((p) => p[0]).slice(0, 2).join('');
// Monograma de color estable por nombre (no se usan fotos de personas reales)
const HUES = ['from-brand-500 to-brand-800', 'from-sky-500 to-indigo-700', 'from-amber-500 to-orange-700', 'from-emerald-500 to-teal-700'];

/** @param {{ items: { name: string, role: string, org: string, rating: number, quote: string }[] }} props */
export function Testimonials({ items }) {
  return (
    <>
      <ul className="grid gap-4 md:grid-cols-2">
        {items.map((t, i) => (
          <Reveal as="li" key={t.name} index={i}>
            <figure className="flex h-full flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900 sm:p-8">
              <div className="flex gap-0.5 text-amber-500" role="img" aria-label={`${t.rating} de 5 estrellas`}>
                {Array.from({ length: 5 }, (_, k) => (
                  <svg key={k} viewBox="0 0 24 24" className={`h-4 w-4 ${k < t.rating ? 'fill-current' : 'fill-slate-200 dark:fill-slate-700'}`} aria-hidden="true">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                ))}
              </div>
              <blockquote className="text-pretty mt-4 flex-1 text-lg leading-relaxed text-slate-800 dark:text-slate-200">“{t.quote}”</blockquote>
              <figcaption className="mt-6 flex items-center gap-3">
                <span className={`grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br ${HUES[i % HUES.length]} font-semibold text-white`} aria-hidden="true">{initials(t.name)}</span>
                <span className="flex-1">
                  <span className="block font-semibold text-slate-900 dark:text-white">{t.name}</span>
                  <span className="text-sm text-slate-500 dark:text-slate-400">{t.role} · {t.org}</span>
                </span>
                <span className="hidden items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 sm:flex dark:border-white/10 dark:text-slate-300">
                  <Icon name={t.org.startsWith('Torres') ? 'building' : 'trees'} className="h-3.5 w-3.5" />{t.org}
                </span>
              </figcaption>
            </figure>
          </Reveal>
        ))}
      </ul>
      <p className="mt-6 text-center text-xs text-slate-500">Testimonios ilustrativos.</p>
    </>
  );
}
