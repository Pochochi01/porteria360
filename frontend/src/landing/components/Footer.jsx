import { Link } from 'react-router-dom';
import { Icon } from '../../components/icons';
import { CONTACT, FOOTER } from '../data/content';
import { Logo } from './Navbar';

const isInternal = (href) => href.startsWith('/') && !href.startsWith('/api');

export function Footer() {
  return (
    <footer className="defer-render border-t border-slate-200 px-4 py-14 sm:px-6 dark:border-white/10">
      <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            La plataforma para administrar countries, barrios privados y edificios desde un único lugar.
          </p>
          <address className="mt-5 space-y-2 text-sm not-italic text-slate-600 dark:text-slate-400" aria-label="Contacto">
            <a href={`mailto:${CONTACT.email}`} className="flex items-center gap-2 hover:text-slate-900 dark:hover:text-white"><Icon name="message" className="h-4 w-4" />{CONTACT.email}</a>
            <a href={`tel:${CONTACT.phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-2 hover:text-slate-900 dark:hover:text-white"><Icon name="bell" className="h-4 w-4" />{CONTACT.phone}</a>
            <span className="flex items-center gap-2"><Icon name="pin" className="h-4 w-4" />{CONTACT.city}</span>
          </address>
        </div>
        {FOOTER.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{col.title}</h3>
            <ul className="mt-4 space-y-2.5">
              {col.links.map(([label, href]) => (
                <li key={label}>
                  {isInternal(href)
                    ? <Link to={href} className="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">{label}</Link>
                    : <a href={href} className="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">{label}</a>}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="mx-auto mt-12 flex max-w-6xl flex-col items-center justify-between gap-3 border-t border-slate-200 pt-6 text-xs text-slate-500 sm:flex-row dark:border-white/10">
        <p>© {new Date().getFullYear()} AdminCountrys. Todos los derechos reservados.</p>
        <p>Hecho en Argentina</p>
      </div>
    </footer>
  );
}
