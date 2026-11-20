/**
 * Posición actual del dispositivo. Nunca rechaza: sin permiso, sin GPS o por timeout devuelve {}.
 * Uso "de mejor esfuerzo" (emergencias). Para validar un punto de control usar acquireFix.
 * @param {number} [timeout] ms
 * @returns {Promise<{ lat?: number, lng?: number }>}
 */
export function currentPosition(timeout = 5000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({});
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({}),
      { timeout }
    );
  });
}

/** @typedef {{ lat: number, lng: number, accuracy: number, timestamp: number }} Fix */
/** @typedef {'denied'|'disabled'|'timeout'|'unsupported'|'insecure'|'error'} GeoError */

/** Mensajes para cada motivo por el que no hay ubicación. */
export const GEO_ERRORS = {
  denied: 'Permiso de ubicación denegado. No es posible registrar el control. Habilítelo en los ajustes del navegador para este sitio.',
  disabled: 'GPS no disponible. Active la ubicación y vuelva a intentarlo.',
  timeout: 'No se pudo obtener la ubicación a tiempo. Salga a cielo abierto y vuelva a intentarlo.',
  unsupported: 'Este navegador no permite obtener la ubicación. Use Chrome, Edge o Safari actualizados.',
  insecure: 'La ubicación solo funciona con conexión segura (HTTPS). Avise al administrador.',
  error: 'Debe activar la ubicación de su dispositivo para registrar este punto de control.',
};

/** Distancia en metros (Haversine). Solo para mostrar: el backend recalcula y decide. */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Motivo por el que este navegador no puede dar ubicación, o null. */
export function geoUnavailableReason() {
  if (typeof window !== 'undefined' && window.isSecureContext === false) { return 'insecure'; }
  if (typeof navigator === 'undefined' || !navigator.geolocation) { return 'unsupported'; }
  return null;
}

/** Estado del permiso sin pedirlo ('granted' | 'denied' | 'prompt' | 'unknown'). iOS < 16 no lo informa. */
export async function geoPermission() {
  try {
    const st = await navigator.permissions?.query({ name: 'geolocation' });
    return st?.state || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Obtiene una lectura GPS fresca y lo más precisa posible: escucha el GPS hasta llegar a `maxAccuracy`
 * o hasta `timeout`, y resuelve con la mejor lectura. Nunca usa posiciones cacheadas.
 * @param {{ maxAccuracy?: number, timeout?: number, onProgress?: (fix: Fix) => void, signal?: AbortSignal }} [opts]
 * @returns {Promise<{ ok: true, fix: Fix } | { ok: false, error: GeoError, fix?: Fix }>}
 */
export function acquireFix({ maxAccuracy = 50, timeout = 20000, onProgress, signal } = {}) {
  return new Promise((resolve) => {
    const reason = geoUnavailableReason();
    if (reason) { resolve({ ok: false, error: reason }); return; }
    /** @type {Fix | undefined} */
    let best;
    let watchId = null;
    let timer = null;
    const finish = (r) => {
      if (watchId !== null) { navigator.geolocation.clearWatch(watchId); }
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(r);
    };
    const onAbort = () => finish({ ok: false, error: 'error', fix: best });
    signal?.addEventListener('abort', onAbort);
    // Al vencer el tiempo: la mejor lectura obtenida (el backend decidirá si alcanza la precisión)
    timer = setTimeout(() => finish(best ? { ok: true, fix: best } : { ok: false, error: 'timeout' }), timeout);
    watchId = navigator.geolocation.watchPosition(
      (p) => {
        const fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, timestamp: Math.round(p.timestamp || Date.now()) };
        if (!best || fix.accuracy <= best.accuracy) { best = fix; }
        onProgress?.(fix);
        if (fix.accuracy <= maxAccuracy) { finish({ ok: true, fix }); }
      },
      (err) => {
        // 1 PERMISSION_DENIED · 2 POSITION_UNAVAILABLE (GPS apagado / sin señal) · 3 TIMEOUT
        if (err.code === 3 && !best) { return; } // el watch sigue intentando hasta nuestro timeout
        finish(best ? { ok: true, fix: best } : { ok: false, error: err.code === 1 ? 'denied' : err.code === 2 ? 'disabled' : 'error' });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout }
    );
  });
}
