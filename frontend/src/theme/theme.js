import { createContext, useContext } from 'react';

/** @typedef {'light' | 'dark' | 'system'} ThemePreference */

export const KEY = 'theme';
export const ThemeCtx = createContext(null);
const isBrowser = typeof window !== 'undefined';
export const media = () => (isBrowser ? window.matchMedia('(prefers-color-scheme: dark)') : { matches: false });

/** @returns {ThemePreference} */
export const readPref = () => {
  if (!isBrowser) { return 'system'; }
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
};

/** Aplica la clase .dark en <html>. Con animate, activa una transición de color de ~700ms. */
export function apply(dark, animate) {
  const root = document.documentElement;
  if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('theme-transition');
    window.clearTimeout(apply.t);
    apply.t = window.setTimeout(() => root.classList.remove('theme-transition'), 750);
  }
  root.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#020617' : '#0f766e');
}

/** @returns {{ pref: ThemePreference, dark: boolean, setTheme: (p: ThemePreference) => void, toggle: () => void }} */
export const useTheme = () => useContext(ThemeCtx);

/** Aplica el tema guardado antes del primer render (evita el destello claro→oscuro). */
export function applyInitialTheme() {
  const pref = readPref();
  apply(pref === 'dark' || (pref === 'system' && media().matches), false);
}
