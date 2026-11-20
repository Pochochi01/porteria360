// Validación geográfica de los puntos de control de las rondas.
// El backend es la única autoridad: recalcula distancia y precisión y decide el estado final.
// El cliente solo informa lo que midió el dispositivo (o por qué no pudo medir).
import { z } from 'zod';

const num = (v, def) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : def);

/** Parámetros configurables por variable de entorno. */
export const GEO = Object.freeze({
  /** Precisión GPS máxima aceptada (coords.accuracy, en metros). */
  maxAccuracyM: num(process.env.GPS_MAX_ACCURACY_M, 50),
  /** Radio por defecto de un punto nuevo. */
  defaultRadiusM: num(process.env.CHECKPOINT_DEFAULT_RADIUS_M, 30),
  /** Antigüedad máxima de la lectura GPS (evita posiciones cacheadas de otro lugar). */
  maxFixAgeMs: num(process.env.GPS_MAX_FIX_AGE_S, 120) * 1000,
});

/**
 * Estados de validación de un escaneo (columna round_scans.status).
 * Equivalencias con la especificación: VALIDO, FUERA_DE_RADIO, GPS_IMPRECISO, GPS_DESACTIVADO,
 * GPS_DENEGADO, ERROR_UBICACION y PUNTO_SIN_UBICACION (el punto todavía no tiene coordenadas cargadas).
 */
export const SCAN_STATUS = ['valid', 'out_of_range', 'gps_inaccurate', 'gps_disabled', 'gps_denied', 'location_error', 'point_unlocated'];

/** Estados que se consideran posible intento de fraude (quedan en audit_log para informes). */
export const SUSPICIOUS = new Set(['out_of_range', 'gps_inaccurate', 'gps_denied']);

const R = 6371008.8; // radio medio terrestre (m)
const rad = (d) => (d * Math.PI) / 180;

/** Distancia en metros entre dos coordenadas (fórmula de Haversine). */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const zLat = z.number().min(-90).max(90);
export const zLng = z.number().min(-180).max(180);

/** Lo que el dispositivo informa al escanear: una posición, o el motivo por el que no la obtuvo. */
export const zGeoReport = z.object({
  position: z.object({
    lat: zLat,
    lng: zLng,
    accuracy: z.number().positive().max(100000),
    timestamp: z.number().int().positive().optional(), // epoch ms de la lectura (coords.timestamp)
  }).nullable().optional(),
  geo_error: z.enum(['denied', 'disabled', 'timeout', 'unsupported', 'insecure', 'error']).nullable().optional(),
});

const ERROR_STATUS = { denied: 'gps_denied', disabled: 'gps_disabled', unsupported: 'gps_disabled', insecure: 'gps_disabled', timeout: 'location_error', error: 'location_error' };

/** Mensajes para el guardia (el backend los define; el frontend solo los muestra). */
export function scanMessage(status, { distance, accuracy, radius } = {}) {
  switch (status) {
    case 'valid': return 'Punto registrado correctamente.';
    case 'out_of_range': return `Usted se encuentra a ${Math.round(distance)} metros del punto de control (radio permitido: ${radius} m). Acérquese para registrar el recorrido.`;
    case 'gps_inaccurate': return `La precisión GPS actual (±${Math.round(accuracy)} m) es insuficiente para validar este punto. Espere unos segundos y vuelva a intentar.`;
    case 'gps_denied': return 'Permiso de ubicación denegado. No es posible registrar el control.';
    case 'gps_disabled': return 'GPS no disponible. Active la ubicación y vuelva a intentarlo.';
    case 'point_unlocated': return 'Este punto de control todavía no tiene ubicación cargada. Avise al supervisor.';
    default: return 'No se pudo obtener una ubicación válida. Vuelva a intentarlo.';
  }
}

/**
 * Decide el estado final de un escaneo.
 * @param {{ lat: number|null, lng: number|null, radius_m: number }} checkpoint
 * @param {z.infer<typeof zGeoReport>} report
 * @param {number} [now] epoch ms
 * @returns {{ status: string, distance: number|null, accuracy: number|null, message: string }}
 */
export function evaluateScan(checkpoint, report, now = Date.now()) {
  const p = report.position;
  const out = (status, distance = null) => ({
    status, distance, accuracy: p?.accuracy ?? null,
    message: scanMessage(status, { distance, accuracy: p?.accuracy, radius: Number(checkpoint.radius_m) }),
  });
  if (!p) { return out(ERROR_STATUS[report.geo_error] || 'location_error'); }
  // Lectura vieja (o con el reloj muy adelantado): no prueba dónde está el guardia ahora
  if (p.timestamp && (now - p.timestamp > GEO.maxFixAgeMs || p.timestamp - now > GEO.maxFixAgeMs)) { return out('location_error'); }
  if (checkpoint.lat == null || checkpoint.lng == null) { return out('point_unlocated'); }
  const distance = haversineMeters(p.lat, p.lng, Number(checkpoint.lat), Number(checkpoint.lng));
  // La precisión se valida antes que la distancia: con ±200 m la distancia calculada no significa nada
  if (p.accuracy > GEO.maxAccuracyM) { return out('gps_inaccurate', distance); }
  if (distance > Number(checkpoint.radius_m)) { return out('out_of_range', distance); }
  return out('valid', distance);
}
