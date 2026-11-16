import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';

/**
 * Cuenta de 0 a `target` cuando `start` pasa a true (ease-out, ~1.6s).
 * @param {number} target
 * @param {boolean} start
 */
export function useCountUp(target, start, duration = 1600) {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!start) { return; }
    if (reduce) { return setValue(target); }
    let raf;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min((now - t0) / duration, 1);
      setValue(Math.round(target * (1 - (1 - p) ** 4)));
      if (p < 1) { raf = requestAnimationFrame(tick); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, start, duration, reduce]);
  return value;
}
