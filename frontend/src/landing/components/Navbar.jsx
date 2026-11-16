import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/icons';
import { ThemeToggle } from '../../components/ThemeToggle';

const LINKS = [
  ['Beneficios', '#beneficios'],
  ['Comunidades', '#comunidades'],
  ['Funcionalidades', '#funcionalidades'],
  ['Panel', '#panel'],
  ['Galería', '#galeria'],
];

export function Logo({ className = '' }) {
  return (
    <span className={`flex items-center gap-2 font-display text-lg font-extrabold tracking-tight text-slate-900 dark:text-white ${className}`}>
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-800 text-white shadow-lg shadow-brand-700/30">
        <Icon name="home" className="h-[18px] w-[18px]" strokeWidth={2.2} />
      </span>
      AdminCountrys
    </span>
  );
}

/** @param {{ onDemo: () => void }} props */
export function Navbar({ onDemo }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  useEffect(() => {
    if (!open) { return; }
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);

  return (
    <header className="fixed inset-x-0 top-0 z-40 px-3 pt-3 sm:px-6">
      <nav aria-label="Principal"
        className={`mx-auto flex max-w-6xl items-center justify-between rounded-2xl px-3 py-2 transition-[background-color,box-shadow,border-color] duration-300 ease-out sm:px-4 ${
          scrolled || open ? 'glass' : 'border border-transparent'}`}>
        <a href="#inicio" className="rounded-lg" aria-label="AdminCountrys, inicio"><Logo /></a>
        <ul className="hidden items-center gap-1 lg:flex">
          {LINKS.map(([label, href]) => (
            <li key={href}>
              <a href={href} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white">{label}</a>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link to="/login" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:text-slate-950 sm:block dark:text-slate-300 dark:hover:text-white">Ingresar</Link>
          <button type="button" onClick={onDemo} className="btn-primary hidden rounded-full px-4 sm:inline-flex">Solicitar demo</button>
          <button type="button" className="grid h-9 w-9 place-items-center rounded-full lg:hidden" aria-expanded={open} aria-controls="mobile-menu"
            aria-label={open ? 'Cerrar menú' : 'Abrir menú'} onClick={() => setOpen((o) => !o)}>
            <Icon name={open ? 'x' : 'menu'} />
          </button>
        </div>
      </nav>
      <div id="mobile-menu" hidden={!open}
        className="glass mx-auto mt-2 max-w-6xl rounded-2xl p-2 lg:hidden">
        {LINKS.map(([label, href]) => (
          <a key={href} href={href} onClick={() => setOpen(false)} className="block rounded-xl px-4 py-3 text-base font-medium text-slate-800 active:bg-slate-100 dark:text-slate-100 dark:active:bg-white/5">{label}</a>
        ))}
        <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-200 p-2 pt-3 dark:border-white/10">
          <Link to="/login" className="btn-secondary">Ingresar</Link>
          <button type="button" onClick={() => { setOpen(false); onDemo(); }} className="btn-primary">Solicitar demo</button>
        </div>
      </div>
    </header>
  );
}
