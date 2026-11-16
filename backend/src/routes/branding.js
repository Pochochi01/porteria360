import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query, tx } from '../lib/db.js';
import { ah, audit, validate, HttpError } from '../lib/helpers.js';
import { requireRole } from '../middleware/auth.js';
import { IMAGE_MIME, LIMITS, VIDEO_MIME, publicUrl, removeAsset, storeAsset } from '../lib/files.js';

export const FONTS = ['Inter', 'Manrope', 'Plus Jakarta Sans', 'DM Sans', 'Outfit', 'Sora', 'Playfair Display', 'Fraunces'];
const GALLERY_CATEGORIES = ['countries', 'edificios', 'barrios', 'premium', 'amenities'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.video * 1024 * 1024 },
  fileFilter: (req, f, cb) => cb(null, [...IMAGE_MIME, ...VIDEO_MIME, 'image/svg+xml'].includes(f.mimetype)),
});

const url = publicUrl;

/** Branding completo de un complejo (lo usan el panel y la página pública). */
async function loadBranding(tenantId) {
  const [s] = await query(
    `SELECT t.id AS tenant_id, t.name, t.slug, s.*, th.name AS theme_name,
       COALESCE(s.primary_color, th.primary_color) AS primary_resolved,
       COALESCE(s.accent_color, th.accent_color) AS accent_resolved,
       COALESCE(s.font_display, th.font_display) AS font_display_resolved,
       COALESCE(s.font_body, th.font_body) AS font_body_resolved,
       lg.path AS logo_path, cv.path AS cover_path, vd.path AS video_path
     FROM tenants t
     LEFT JOIN tenant_settings s ON s.tenant_id=t.id
     LEFT JOIN tenant_themes th ON th.id=s.theme_id
     LEFT JOIN tenant_assets lg ON lg.id=s.logo_asset_id
     LEFT JOIN tenant_assets cv ON cv.id=s.cover_asset_id
     LEFT JOIN tenant_assets vd ON vd.id=s.video_asset_id
     WHERE t.id=?`, [tenantId]);
  if (!s) { throw new HttpError(404, 'Complejo no encontrado'); }
  const gallery = await query(
    `SELECT g.id, g.title, g.category, g.sort_order, a.path, a.width, a.height FROM tenant_gallery g
     JOIN tenant_assets a ON a.id=g.asset_id WHERE g.tenant_id=? ORDER BY g.sort_order, g.id`, [tenantId]);
  return {
    tenant: { id: s.tenant_id, name: s.name, slug: s.slug },
    settings: {
      theme_id: s.theme_id ?? null,
      display_name: s.display_name || s.name,
      tagline: s.tagline ?? null,
      description: s.description ?? null,
      primary_color: s.primary_resolved || '#0f766e',
      accent_color: s.accent_resolved || '#f59e0b',
      font_display: s.font_display_resolved || 'Manrope',
      font_body: s.font_body_resolved || 'Inter',
      custom: { primary_color: s.primary_color ?? null, accent_color: s.accent_color ?? null, font_display: s.font_display ?? null, font_body: s.font_body ?? null },
      logo_url: url(s.logo_path), cover_url: url(s.cover_path), video_url: url(s.video_path) || s.video_url || null,
      video_external: s.video_url ?? null,
      public_enabled: !!s.public_enabled,
    },
    gallery: gallery.map((g) => ({ id: g.id, title: g.title, category: g.category, sort_order: g.sort_order, url: url(g.path), width: g.width, height: g.height })),
  };
}

// ---------- Rutas públicas (sin JWT) ----------
export const publicBranding = Router();

publicBranding.get('/themes', ah(async (req, res) => {
  res.json({ themes: await query('SELECT * FROM tenant_themes ORDER BY id'), fonts: FONTS });
}));

publicBranding.get('/tenants/:slug', ah(async (req, res) => {
  const [t] = await query(
    `SELECT t.id FROM tenants t JOIN tenant_settings s ON s.tenant_id=t.id
     WHERE t.slug=? AND t.active=1 AND s.public_enabled=1 AND t.slug<>'plataforma'`, [req.params.slug]);
  if (!t) { throw new HttpError(404, 'Este complejo no tiene página pública'); }
  const b = await loadBranding(t.id);
  delete b.settings.custom;
  res.set('Cache-Control', 'public, max-age=60').json(b);
}));

publicBranding.post('/demo-requests',
  rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, message: { error: 'Demasiadas solicitudes, probá más tarde' } }),
  validate(z.object({
    name: z.string().trim().min(2, 'Ingresá tu nombre').max(120),
    email: z.string().trim().email('Email inválido').max(160),
    phone: z.string().trim().max(30).optional(),
    organization: z.string().trim().max(160).optional(),
    kind: z.enum(['country', 'barrio', 'edificio', 'otro']).default('country'),
    units: z.number().int().min(1).max(100000).optional(),
    message: z.string().trim().max(1000).optional(),
    website: z.string().max(0, 'spam').optional(), // honeypot: los bots lo completan
  })),
  ah(async (req, res) => {
    const b = req.body;
    await query('INSERT INTO demo_requests (name,email,phone,organization,kind,units,message,ip) VALUES (?,?,?,?,?,?,?,?)',
      [b.name, b.email, b.phone ?? null, b.organization ?? null, b.kind, b.units ?? null, b.message ?? null, req.ip]);
    res.status(201).json({ ok: true });
  }));

// ---------- Rutas del panel (JWT + admin) ----------
const r = Router();

r.get('/branding/current', ah(async (req, res) => {
  const b = await loadBranding(req.tenantId);
  delete b.settings.custom;
  res.json(b);
}));

r.get('/branding', requireRole('admin'), ah(async (req, res) => res.json(await loadBranding(req.tenantId))));

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color en formato #RRGGBB');
r.put('/branding', requireRole('admin'),
  validate(z.object({
    theme_id: z.number().int().nullable(),
    display_name: z.string().trim().max(120).nullable(),
    tagline: z.string().trim().max(200).nullable(),
    description: z.string().trim().max(1000).nullable(),
    primary_color: hex.nullable(),
    accent_color: hex.nullable(),
    font_display: z.enum(FONTS).nullable(),
    font_body: z.enum(FONTS).nullable(),
    video_url: z.string().trim().url('URL inválida').max(255).refine((u) => /^https:\/\//.test(u), 'Debe ser https').nullable(),
    public_enabled: z.boolean(),
  }).partial().strict()),
  ah(async (req, res) => {
    const b = { ...req.body };
    for (const k of Object.keys(b)) { if (b[k] === '') { b[k] = null; } }
    if (b.theme_id != null && !(await query('SELECT id FROM tenant_themes WHERE id=?', [b.theme_id])).length) { throw new HttpError(400, 'Tema inexistente'); }
    const cols = Object.keys(b);
    if (cols.length) {
      await query(
        `INSERT INTO tenant_settings (tenant_id,${cols.join(',')}) VALUES (?,${cols.map(() => '?').join(',')})
         ON DUPLICATE KEY UPDATE ${cols.map((c) => `${c}=VALUES(${c})`).join(',')}`,
        [req.tenantId, ...cols.map((c) => b[c])]);
    }
    await audit(req, 'branding', req.tenantId, 'update', b);
    res.json(await loadBranding(req.tenantId));
  }));

// Subida: kind = logo | cover | video | image (image → se agrega a la galería)
r.post('/branding/assets', requireRole('admin'), upload.single('file'), ah(async (req, res) => {
  const kind = String(req.body.kind || '');
  if (!['logo', 'cover', 'video', 'image'].includes(kind)) { throw new HttpError(400, 'kind debe ser logo, cover, video o image'); }
  const asset = await storeAsset(req.tenantId, kind, req.file);
  if (kind === 'image') {
    const category = GALLERY_CATEGORIES.includes(req.body.category) ? req.body.category : 'premium';
    const [{ n }] = await query('SELECT COALESCE(MAX(sort_order),0)+1 n FROM tenant_gallery WHERE tenant_id=?', [req.tenantId]);
    await query('INSERT INTO tenant_gallery (tenant_id,asset_id,title,category,sort_order) VALUES (?,?,?,?,?)',
      [req.tenantId, asset.id, String(req.body.title || '').slice(0, 120) || null, category, n]);
  } else {
    // Reemplaza el anterior y borra su archivo
    const col = `${kind}_asset_id`;
    const [prev] = await query(`SELECT ${col} AS id FROM tenant_settings WHERE tenant_id=?`, [req.tenantId]);
    await query(`INSERT INTO tenant_settings (tenant_id,${col}) VALUES (?,?) ON DUPLICATE KEY UPDATE ${col}=VALUES(${col})`, [req.tenantId, asset.id]);
    if (prev?.id) { await removeAsset(req.tenantId, prev.id); }
  }
  await audit(req, 'branding', req.tenantId, `upload_${kind}`, { asset: asset.id, size: req.file.size });
  res.status(201).json(await loadBranding(req.tenantId));
}));

r.delete('/branding/assets/:kind', requireRole('admin'), ah(async (req, res) => {
  const kind = req.params.kind;
  if (!['logo', 'cover', 'video'].includes(kind)) { throw new HttpError(400, 'kind inválido'); }
  const [s] = await query(`SELECT ${kind}_asset_id AS id FROM tenant_settings WHERE tenant_id=?`, [req.tenantId]);
  if (s?.id) { await removeAsset(req.tenantId, s.id); }
  await audit(req, 'branding', req.tenantId, `delete_${kind}`);
  res.json(await loadBranding(req.tenantId));
}));

r.put('/branding/gallery/:id', requireRole('admin'),
  validate(z.object({ title: z.string().trim().max(120).nullable(), category: z.enum(GALLERY_CATEGORIES), sort_order: z.number().int() }).partial().strict()),
  ah(async (req, res) => {
    const cols = Object.keys(req.body);
    if (!cols.length) { throw new HttpError(400, 'No se enviaron cambios'); }
    const x = await query(`UPDATE tenant_gallery SET ${cols.map((c) => `${c}=?`).join(',')} WHERE id=? AND tenant_id=?`,
      [...cols.map((c) => req.body[c]), req.params.id, req.tenantId]);
    if (!x.affectedRows) { throw new HttpError(404, 'Imagen no encontrada'); }
    await audit(req, 'tenant_gallery', Number(req.params.id), 'update', req.body);
    res.json(await loadBranding(req.tenantId));
  }));

r.delete('/branding/gallery/:id', requireRole('admin'), ah(async (req, res) => {
  const [g] = await query('SELECT asset_id FROM tenant_gallery WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
  if (!g) { throw new HttpError(404, 'Imagen no encontrada'); }
  await removeAsset(req.tenantId, g.asset_id);
  await audit(req, 'tenant_gallery', Number(req.params.id), 'delete');
  res.json(await loadBranding(req.tenantId));
}));

// Orden de la galería: [{ id, sort_order }]
r.post('/branding/gallery/reorder', requireRole('admin'),
  validate(z.object({ order: z.array(z.number().int()).min(1).max(500) })),
  ah(async (req, res) => {
    await tx(async (c) => {
      for (const [i, id] of req.body.order.entries()) { await c.execute('UPDATE tenant_gallery SET sort_order=? WHERE id=? AND tenant_id=?', [i + 1, id, req.tenantId]); }
    });
    res.json(await loadBranding(req.tenantId));
  }));

// Pedidos de demo (solo superadmin)
r.get('/platform/demo-requests', requireRole('superadmin'), ah(async (req, res) => {
  res.json(await query('SELECT * FROM demo_requests ORDER BY created_at DESC LIMIT 500'));
}));

export default r;
