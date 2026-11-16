import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KEY, ThemeCtx, apply, media, readPref } from './theme';

export function ThemeProvider({ children }) {
  const [pref, setPref] = useState(readPref);
  const [systemDark, setSystemDark] = useState(() => media().matches);
  const dark = pref === 'dark' || (pref === 'system' && systemDark);

  useEffect(() => {
    const m = media();
    const on = (e) => setSystemDark(e.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);

  // La transición de colores solo cuando el usuario cambia el tema (nunca al cargar: sería un recálculo de estilos enorme)
  const first = useRef(true);
  useEffect(() => {
    apply(dark, !first.current);
    first.current = false;
  }, [dark]);

  /** @param {ThemePreference} next */
  const setTheme = useCallback((next) => {
    setPref(next);
    try {
      next === 'system' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, next);
    } catch { /* modo privado: solo en memoria */ }
  }, []);

  const toggle = useCallback(() => setTheme(dark ? 'light' : 'dark'), [dark, setTheme]);
  const value = useMemo(() => ({ pref, dark, setTheme, toggle }), [pref, dark, setTheme, toggle]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}
