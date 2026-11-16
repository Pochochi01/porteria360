import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ah, validate, HttpError } from '../lib/helpers.js';
import { requireRole } from '../middleware/auth.js';
import { ocrDni } from '../lib/dniOcr.js';

const r = Router();
const STAFF = ['guard', 'supervisor', 'admin'];
const MAX_MB = 8;
const MIME = ['image/jpeg', 'image/png', 'image/webp'];

// En memoria: la imagen no se guarda nunca en disco (se descarta al terminar el request)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, f, cb) => (MIME.includes(f.mimetype) ? cb(null, true) : cb(new HttpError(415, 'Formato no permitido. Usá JPG, PNG o WebP'))),
});

/** Log sin datos personales: solo evento, resultado, campos encontrados y tiempo. */
const log = (event, data) => console.log(`[dni] ${event}`, JSON.stringify(data));

// OCR de una foto del DNI (fallback cuando no se puede leer el PDF417)
r.post('/dni/ocr', requireRole(...STAFF),
  rateLimit({ windowMs: 60 * 1000, limit: 20, message: { error: 'Demasiados intentos, esperá un minuto' } }),
  upload.single('image'),
  ah(async (req, res) => {
    const t0 = performance.now();
    if (!req.file) { throw new HttpError(400, 'Imagen requerida'); }
    // El mimetype lo declara el cliente: se verifica el contenido real
    const meta = await sharp(req.file.buffer).metadata().catch(() => null);
    if (!meta || !['jpeg', 'png', 'webp'].includes(meta.format)) { throw new HttpError(415, 'El archivo no es una imagen JPG, PNG o WebP válida'); }
    if (meta.width < 300 || meta.height < 200) { throw new HttpError(422, 'La imagen es demasiado chica para leer el DNI'); }
    try {
      const result = await ocrDni(req.file.buffer);
      const ms = Math.round(performance.now() - t0);
      log('ocr', { tenant: req.tenantId, ok: result.found, fuente: result.fuente, campos: ['apellido', 'nombre', 'dni'].filter((k) => result[k]), conf: result.confidence, ms });
      res.json({ ...result, ms });
    } catch (e) {
      log('ocr_error', { tenant: req.tenantId, error: e.message?.slice(0, 120), ms: Math.round(performance.now() - t0) });
      throw new HttpError(502, 'No se pudo procesar la imagen. Probá de nuevo o cargá los datos a mano');
    } finally {
      req.file.buffer = null; // libera la imagen
    }
  }));

// Eventos del lector del navegador (PDF417 leído, fallback a OCR, errores). Sin datos personales.
r.post('/dni/events', requireRole(...STAFF),
  validate(z.object({
    event: z.enum(['pdf417_ok', 'pdf417_parse_error', 'pdf417_timeout', 'ocr_fallback', 'camera_error', 'manual']),
    ms: z.number().int().min(0).max(600000).optional(),
    formato: z.enum(['nuevo', 'anterior']).optional(),
    detail: z.string().max(80).optional(),
  }).strict()), // rechaza cualquier campo extra (p. ej. datos personales enviados por error)
  (req, res) => {
    log(req.body.event, { tenant: req.tenantId, ...req.body, event: undefined });
    res.status(204).end();
  });

export default r;
