import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../lib/db.js';
import { ah, validate } from '../lib/helpers.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { registerDevice } from './notifications.js';

const r = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 });

async function loadUserWithRoles(where, params) {
  const rows = await query(
    `SELECT u.id,u.tenant_id,u.email,u.password_hash,u.full_name,u.lot_id,u.active,t.active AS tenant_active,
            GROUP_CONCAT(ro.name) AS roles
     FROM users u JOIN tenants t ON t.id=u.tenant_id
     LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles ro ON ro.id=ur.role_id
     WHERE ${where} GROUP BY u.id`,
    params
  );
  const u = rows[0];
  if (u) { u.roles = u.roles ? u.roles.split(',') : []; }
  return u;
}

r.post(
  '/login',
  loginLimiter,
  validate(z.object({ tenant: z.string().optional(), email: z.string().email(), password: z.string().min(1) })),
  ah(async (req, res) => {
    const { email, password } = req.body;
    // Sin complejo → login de plataforma (superadmin)
    const tenant = req.body.tenant?.trim() || 'plataforma';
    const u = await loadUserWithRoles('t.slug=? AND u.email=?', [tenant, email.toLowerCase()]);
    if (!u || !u.active || !u.tenant_active || !(await bcrypt.compare(password, u.password_hash))) { return res.status(401).json({ error: 'Credenciales inválidas' }); }
    const { password_hash, active, tenant_active, ...user } = u;
    res.json({ token: signToken(user), user });
  })
);

r.get(
  '/me',
  authenticate,
  ah(async (req, res) => {
    const superadmin = req.user.roles.includes('superadmin');
    // El superadmin vive en el tenant "plataforma" pero puede operar dentro de otro complejo
    const u = superadmin
      ? await loadUserWithRoles('u.id=?', [req.user.id])
      : await loadUserWithRoles('u.id=? AND u.tenant_id=?', [req.user.id, req.tenantId]);
    if (!u) { return res.status(404).end(); }
    const { password_hash, ...user } = u;
    if (superadmin) { Object.assign(user, { tenant_id: req.tenantId, roles: req.user.roles }); }
    res.json(user);
  })
);

// Registro de suscripción Web Push del dispositivo actual
r.post(
  '/push-subscription',
  authenticate,
  validate(z.object({ endpoint: z.string().url().max(500), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }), platform: z.string().max(20).optional() })),
  registerDevice // mismo servicio que POST /api/notifications/devices
);

r.get('/vapid-key', (req, res) => res.json({ key: process.env.VAPID_PUBLIC_KEY || null }));

export default r;
