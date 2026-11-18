// Rutas absolutas del backend, calculadas desde la ubicación real de este archivo
// (no desde process.cwd()). Así el servidor funciona igual con `npm run dev`,
// `node src/server.js`, PM2 con cualquier cwd, tests y scripts de mantenimiento.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); // backend/src/lib

export const BACKEND_ROOT = path.resolve(here, '..', '..'); // backend/
export const PROJECT_ROOT = path.resolve(BACKEND_ROOT, '..'); // raíz del repo
export const ENV_FILE = path.join(BACKEND_ROOT, '.env');

export const UPLOADS_ROOT = path.join(BACKEND_ROOT, 'uploads');
export const UPLOADS = path.join(UPLOADS_ROOT, 'tenants'); // branding público
export const PRIVATE_UPLOADS = path.join(UPLOADS_ROOT, 'private'); // comprobantes privados
export const RECEIPTS_DIR = path.join(UPLOADS_ROOT, 'receipts'); // comprobantes de pago
export const TESSERACT_CACHE = path.join(BACKEND_ROOT, '.tesseract-cache');

// FRONTEND_DIST es opcional. Si es relativa, se resuelve contra backend/ (nunca contra el cwd).
export function frontendDist() {
  const v = process.env.FRONTEND_DIST?.trim();
  if (!v) { return path.join(PROJECT_ROOT, 'frontend', 'dist'); }
  return path.isAbsolute(v) ? v : path.resolve(BACKEND_ROOT, v);
}
