import { useCallback, useEffect, useRef, useState } from 'react';
import { acquireFix, geoPermission, geoUnavailableReason } from '../lib/geo';

/**
 * Ubicación precisa bajo demanda (rondas, alta de puntos de control).
 * - permission: estado del permiso sin pedirlo ('granted' | 'denied' | 'prompt' | 'unknown').
 * - acquire(): pide el permiso si hace falta, espera una lectura precisa y la devuelve.
 *   En iOS el pedido de permiso debe salir de un toque del usuario: llamar acquire() desde un onClick.
 * @param {{ maxAccuracy?: number, timeout?: number }} [opts]
 */
export function useGeolocation({ maxAccuracy = 50, timeout = 20000 } = {}) {
  const [state, setState] = useState(/** @type {'idle'|'locating'|'ready'|'error'} */ ('idle'));
  const [fix, setFix] = useState(null); // última lectura (también las intermedias, para mostrar la precisión en vivo)
  const [error, setError] = useState(/** @type {import('../lib/geo').GeoError | null} */ (geoUnavailableReason()));
  const [permission, setPermission] = useState('unknown');
  const abort = useRef(null);

  useEffect(() => {
    let st;
    const sync = () => setPermission(st.state);
    navigator.permissions?.query({ name: 'geolocation' }).then((s) => { st = s; sync(); s.addEventListener?.('change', sync); }).catch(() => {});
    return () => { st?.removeEventListener?.('change', sync); abort.current?.abort(); };
  }, []);

  const acquire = useCallback(async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setState('locating');
    setError(null);
    const r = await acquireFix({ maxAccuracy, timeout, signal: ctrl.signal, onProgress: setFix });
    if (ctrl.signal.aborted) { return r; }
    if (r.ok) { setFix(r.fix); setState('ready'); } else { setError(r.error); setState('error'); }
    setPermission(await geoPermission());
    return r;
  }, [maxAccuracy, timeout]);

  const cancel = useCallback(() => { abort.current?.abort(); setState('idle'); }, []);

  return { state, fix, error, permission, acquire, cancel, unsupported: geoUnavailableReason() };
}
