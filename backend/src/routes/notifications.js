// Controladores de notificaciones, dispositivos, preferencias, comunicados y panel de administración.
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../lib/db.js';
import { ah, audit, validate, HttpError } from '../lib/helpers.js';
import { requireRole, hasRole } from '../middleware/auth.js';
import * as devices from '../notifications/subscriptions.js';
import * as prefs from '../notifications/preferences.js';
import * as repo from '../notifications/repository.js';
import { checkReadToken } from '../notifications/dispatcher.js';
import { notify } from '../notifications/service.js';
import { publish } from '../notifications/events.js';
import { pushEnabled } from '../notifications/providers.js';
import { CATEGORIES } from '../notifications/templates.js';

const r = Router();
const ADMIN = ['admin'];
const category = z.enum(Object.keys(CATEGORIES));

const deviceSchema = z.union([
  z.object({ endpoint: z.string().url().max(500), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }), platform: z.string().max(20).optional() }),
  z.object({ fcmToken: z.string().min(20).max(255), platform: z.string().max(20).optional() }),
]);

/** Registro del dispositivo actual (también lo usa POST /auth/push-subscription). */
export const registerDevice = ah(async (req, res) => {
  await devices.register({ tenantId: req.tenantId, userId: req.user.id, userAgent: req.get('user-agent'), platform: req.body.platform }, req.body);
  res.status(201).json({ ok: true });
});

// ----- Dispositivos -----
r.get('/notifications/devices', ah(async (req, res) => {
  const list = await devices.listForUser(req.tenantId, req.user.id);
  const current = req.get('x-push-endpoint'); // el cliente indica cuál es "este dispositivo"
  res.json(list.map(({ endpoint, ...d }) => ({ ...d, current: !!current && endpoint === current })));
}));
r.post('/notifications/devices', validate(deviceSchema), registerDevice);
r.delete('/notifications/devices/current', validate(z.object({ endpoint: z.string().optional(), fcmToken: z.string().optional() })), ah(async (req, res) => {
  res.json({ removed: await devices.unregister(req.user.id, req.body) });
}));
r.delete('/notifications/devices/:id', ah(async (req, res) => {
  if (!(await devices.removeById(req.tenantId, req.user.id, Number(req.params.id)))) { throw new HttpError(404, 'Dispositivo no encontrado'); }
  res.json({ ok: true });
}));

// ----- Preferencias -----
r.get('/notifications/preferences', ah(async (req, res) => res.json(await prefs.get(req.user))));
r.put('/notifications/preferences',
  validate(z.object({
    categories: z.record(z.boolean()).optional(),
    reminders: z.record(z.array(z.number().int())).optional(),
  })),
  ah(async (req, res) => res.json(await prefs.update(req.user, req.tenantId, req.body))));

// ----- Bandeja del usuario -----
r.get('/notifications', ah(async (req, res) => {
  const cat = category.safeParse(req.query.category);
  const items = await repo.listForUser(req.tenantId, req.user.id, { category: cat.success ? cat.data : undefined, before: req.query.before, limit: req.query.limit });
  res.json({ items, unread: await repo.unreadCount(req.tenantId, req.user.id) });
}));
r.get('/notifications/unread-count', ah(async (req, res) => res.json({ unread: await repo.unreadCount(req.tenantId, req.user.id) })));
r.post('/notifications/read-all', ah(async (req, res) => res.json({ updated: await repo.markRead(req.tenantId, req.user.id) })));
r.post('/notifications/:id(\\d+)/read', ah(async (req, res) => res.json({ updated: await repo.markRead(req.tenantId, req.user.id, Number(req.params.id)) })));

/** Prueba en los dispositivos del propio usuario (ignora preferencias). */
r.post('/notifications/test', ah(async (req, res) => {
  if (!pushEnabled()) { throw new HttpError(503, 'Las notificaciones push no están configuradas en el servidor'); }
  await notify(req.tenantId, [req.user.id], 'system.test', {}, { force: true });
  res.status(202).json({ ok: true });
}));

// ----- Administración -----
r.get('/notifications/admin/stats', requireRole(...ADMIN), ah(async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  res.json({ ...(await repo.stats(req.tenantId, days)), push_enabled: pushEnabled() });
}));
r.get('/notifications/admin/history', requireRole(...ADMIN), ah(async (req, res) => {
  const cat = category.safeParse(req.query.category);
  const status = ['queued', 'sending', 'sent', 'partial', 'failed', 'no_devices', 'pending', 'read'].includes(req.query.status) ? req.query.status : undefined;
  res.json(await repo.history(req.tenantId, {
    status, category: cat.success ? cat.data : undefined, userId: req.query.user_id, q: String(req.query.q || '').slice(0, 80),
    limit: req.query.limit, offset: req.query.offset,
  }));
}));

// ----- Comunicados -----
const AUDIENCE_ROLES = { owners: ['owner', 'family'], residents: ['owner', 'family', 'resident'], staff: ['admin', 'supervisor', 'guard'] };

r.get('/announcements', ah(async (req, res) => {
  const admin = hasRole(req, ...ADMIN);
  const visible = Object.entries(AUDIENCE_ROLES).filter(([, roles]) => hasRole(req, ...roles)).map(([k]) => k);
  const params = [req.tenantId];
  let where = 'a.tenant_id=?';
  if (!admin) {
    where += ` AND (a.audience='all' OR (a.audience='user' AND a.target_user_id=?)${visible.length ? ` OR a.audience IN (${visible.map(() => '?').join(',')})` : ''})`;
    params.push(req.user.id, ...visible);
  }
  res.json(await query(
    `SELECT a.id, a.kind, a.audience, a.title, a.body, a.created_at, u.full_name AS author, t.full_name AS target_name
       FROM announcements a LEFT JOIN users u ON u.id=a.created_by LEFT JOIN users t ON t.id=a.target_user_id
      WHERE ${where} ORDER BY a.id DESC LIMIT 100`, params));
}));

r.post('/announcements', requireRole(...ADMIN),
  validate(z.object({
    kind: z.enum(['announcement', 'message']).default('announcement'),
    audience: z.enum(['all', 'owners', 'residents', 'staff', 'user']).default('all'),
    target_user_id: z.number().int().optional(),
    title: z.string().trim().min(3).max(160),
    body: z.string().trim().min(1).max(5000),
  }).refine((b) => b.audience !== 'user' || b.target_user_id, { message: 'Elegí el destinatario', path: ['target_user_id'] })),
  ah(async (req, res) => {
    const b = req.body;
    if (b.audience === 'user') {
      const [u] = await query('SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1', [b.target_user_id, req.tenantId]);
      if (!u) { throw new HttpError(400, 'Destinatario inexistente'); }
    }
    const x = await query(
      'INSERT INTO announcements (tenant_id,kind,audience,target_user_id,title,body,created_by) VALUES (?,?,?,?,?,?,?)',
      [req.tenantId, b.kind, b.audience, b.audience === 'user' ? b.target_user_id : null, b.title, b.body, req.user.id]);
    const [a] = await query('SELECT * FROM announcements WHERE id=?', [x.insertId]);
    publish('announcement.published', { tenantId: req.tenantId, announcement: a, actorId: req.user.id });
    await audit(req, 'announcement', a.id, 'published', { audience: b.audience, title: b.title });
    res.status(201).json(a);
  }));

r.delete('/announcements/:id', requireRole(...ADMIN), ah(async (req, res) => {
  const x = await query('DELETE FROM announcements WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
  if (!x.affectedRows) { throw new HttpError(404, 'Comunicado no encontrado'); }
  await audit(req, 'announcement', Number(req.params.id), 'deleted');
  res.json({ ok: true });
}));

export default r;

// ----- Público (sin sesión): llamadas del service worker -----
export const publicNotifications = Router();
publicNotifications.post('/notifications/devices/rotate',
  validate(z.object({ oldEndpoint: z.string().url().max(500), subscription: z.object({ endpoint: z.string().url().max(500), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }) })),
  ah(async (req, res) => {
    // Sin coincidencia responde igual (204): no revela qué endpoints existen
    await devices.rotate(req.body.oldEndpoint, req.body.subscription).catch(() => {});
    res.status(204).end();
  }));
// Lectura informada al tocar la notificación
publicNotifications.post('/notifications/receipt', validate(z.object({ id: z.number().int().positive(), rt: z.string().max(40) })), ah(async (req, res) => {
  if (!checkReadToken(req.body.id, req.body.rt)) { throw new HttpError(403, 'Firma inválida'); }
  await repo.markReadById(req.body.id);
  res.status(204).end();
}));
