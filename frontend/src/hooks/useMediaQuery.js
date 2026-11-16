import { useEffect, useState } from 'react';

/** @param {string} query */
export function useMediaQuery(query) {
  // Arranca en false y se actualiza al montar: así el HTML prerenderizado coincide al hidratar
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = (e) => setMatch(e.matches);
    setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** true en dispositivos con mouse/trackpad (los efectos de hover y parallax solo corren ahí). */
export const useFinePointer = () => useMediaQuery('(hover: hover) and (pointer: fine)');
