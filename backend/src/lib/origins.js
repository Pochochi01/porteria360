// Orígenes permitidos para CORS (HTTP y Socket.IO).
// Producción: lista CORS_ORIGIN separada por comas. Desarrollo: también localhost / red local en cualquier puerto.
const list = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
const devHost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;

export function corsOrigin(origin, cb) {
  // Sin Origin: misma app servida por Express, apps nativas o herramientas (curl, Postman)
  if (!origin || list.includes(origin)) { return cb(null, true); }
  if (process.env.NODE_ENV !== 'production' && devHost.test(origin)) { return cb(null, true); }
  cb(null, false);
}
