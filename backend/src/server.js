import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { corsOrigin } from './lib/origins.js';
import helmet from 'helmet';
import { authenticate } from './middleware/auth.js';
import { initSocket } from './lib/realtime.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import accessRoutes from './routes/access.js';
import roundRoutes, { checkOverdueRounds } from './routes/rounds.js';
import expenseRoutes from './routes/expenses.js';
import reservationRoutes from './routes/reservations.js';
import payments, { publicPayments } from './routes/payments.js';
import emergencyRoutes from './routes/emergencies.js';
import platformRoutes from './routes/platform.js';
import crudRoutes from './routes/crud.js';
import docsRoutes from './routes/docs.js';
import brandingRoutes, { publicBranding } from './routes/branding.js';
import { UPLOADS, PRIVATE_UPLOADS } from './lib/files.js';
import dniRoutes from './routes/dni.js';
import financeRoutes from './routes/finance.js';
import ownerPortalRoutes from './routes/ownerPortal.js';
import { pool } from './lib/db.js';
import { shutdownOcr } from './lib/dniOcr.js';

fs.mkdirSync('uploads/receipts', { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(PRIVATE_UPLOADS, { recursive: true }); // comprobantes de gastos: nunca se sirven estáticos

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      'img-src': ["'self'", 'data:', 'blob:'],
      // Video institucional externo de cada complejo
      // blob: visor de comprobantes PDF (descargados con la sesión); YouTube/Vimeo: video institucional
      'frame-src': ["'self'", 'blob:', 'https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
    },
  },
}));
app.use(compression());
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', docsRoutes); // Swagger UI en /api/docs (público, sin datos)
app.use('/api/auth', authRoutes);
app.use('/api/public', publicBranding); // branding público de cada complejo + pedidos de demo
// Archivos de branding (públicos por diseño). Los comprobantes de pago siguen privados en uploads/receipts.
app.use('/uploads/tenants', express.static(UPLOADS, {
  maxAge: '7d', immutable: true, fallthrough: false,
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
}));
app.use('/api/pagos', publicPayments); // webhook + OAuth callback (sin JWT)
app.use('/api/pagos', payments);

// Todo lo siguiente exige JWT y queda aislado por req.tenantId
const api = express.Router();
api.use(authenticate);
api.use('/platform', platformRoutes);
api.use(crudRoutes); // PUT/DELETE de todos los módulos
api.use(brandingRoutes);
api.use(dniRoutes); // lectura de DNI (OCR) para la guardia
api.use(financeRoutes, ownerPortalRoutes); // expensas: gastos, liquidación, transparencia y portal del propietario
api.use(userRoutes, accessRoutes, roundRoutes, expenseRoutes, reservationRoutes, emergencyRoutes);
app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// Producción: el mismo servidor entrega la PWA compilada (frontend/dist)
const dist = path.resolve(process.env.FRONTEND_DIST || '../frontend/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, setHeaders: (res, f) => {
    if (f.endsWith('sw.js') || f.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (/[\\/]assets[\\/]/.test(f)) {
      // Archivos con hash en el nombre (JS/CSS): caché de 1 año. [\\/] cubre separadores de Windows y Unix.
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (/[\\/]generated-assets[\\/]/.test(f)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000');
    }
  } }));
  // "/" → portada prerenderizada; cualquier otra ruta de la SPA → app.html (sin el HTML de la portada)
  const appHtml = fs.existsSync(path.join(dist, 'app.html')) ? 'app.html' : 'index.html';
  app.get('/', (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(dist, 'index.html')));
  app.get(/^(?!\/api|\/socket\.io|\/uploads).*/, (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(dist, appHtml)));
}

app.use((err, req, res, _next) => { // 4 parámetros: así Express lo trata como manejador de errores
  if (err.code === 'ER_DUP_ENTRY') { return res.status(409).json({ error: 'Registro duplicado' }); }
  if (err.code === 'LIMIT_FILE_SIZE') { return res.status(413).json({ error: 'El archivo es demasiado grande' }); }
  if (err.status === 404 && req.path.startsWith('/uploads/')) { return res.status(404).end(); }
  if (!err.status) { console.error(err); }
  if (err.code === 'ER_ROW_IS_REFERENCED_2') { return res.status(409).json({ error: 'El registro está referenciado por otros datos y no se puede eliminar' }); }
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Error interno', ...err.extra });
});

process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));

// Verifica configuración y base de datos antes de aceptar conexiones
const missing = ['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Faltan variables en .env: ${missing.join(', ')}`);
  process.exit(1);
}
try {
  await pool.query('SELECT 1 FROM tenants LIMIT 1');
} catch (e) {
  console.error(`No se pudo usar la base "${process.env.DB_NAME}": ${e.code} ${e.message}`);
  console.error('Revisá DB_* en .env y ejecutá "npm run db:init".');
  process.exit(1);
}

const server = http.createServer(app);
const io = initSocket(server);
const roundsTimer = setInterval(() => checkOverdueRounds().catch(console.error), 60_000);
const port = Number(process.env.PORT || 4000);
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `El puerto ${port} ya está en uso (¿otro backend abierto?)` : e);
  process.exit(1);
});
server.listen(port, () => console.log(`API en http://127.0.0.1:${port} (${process.env.NODE_ENV || 'development'})`));

// Apagado ordenado (Ctrl+C, docker stop, PM2, systemd): termina lo pendiente y libera recursos
let closing = false;
async function shutdown(signal) {
  if (closing) { return; }
  closing = true;
  console.log(`${signal} recibido: cerrando el servidor…`);
  clearInterval(roundsTimer);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  io.close();
  await new Promise((resolve) => { server.close(resolve); });
  await Promise.allSettled([pool.end(), shutdownOcr()]);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
