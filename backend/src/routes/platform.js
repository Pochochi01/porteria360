import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, tx } from '../lib/db.js';
import { seedCategories } from '../lib/migrate.js';
import { ah, validate, HttpError } from '../lib/helpers.js';
import { requireRole, signToken } from '../middleware/auth.js';

// Administración de la plataforma: alcance sobre todos los complejos (solo superadmin)
const r = Router();
r.use(requireRole('superadmin'));

r.get('/tenants', ah(async (req, res) => {
  res.json(await query(
    `SELECT t.id,t.name,t.slug,t.active,t.created_at,(t.mp_access_token IS NOT NULL) AS mp_linked,
       (SELECT COUNT(*) FROM lots l WHERE l.tenant_id=t.id) AS lots,
       (SELECT COUNT(*) FROM users u WHERE u.tenant_id=t.id) AS users
     FROM tenants t WHERE t.slug<>'plataforma' ORDER BY t.name`));
}));

r.post('/tenants',
  validate(z.object({
    name: z.string().trim().min(2, 'Mínimo 2 caracteres').max(120),
    slug: z.string()
      .transform((s) => s.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
      .pipe(z.string().min(2, 'Mínimo 2 caracteres (letras o números)').max(60).refine((s) => s !== 'plataforma', 'Identificador reservado')),
    admin_email: z.string().trim().email('Email inválido').transform((e) => e.toLowerCase()),
    admin_name: z.string().trim().min(2, 'Mínimo 2 caracteres'),
    admin_password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
  })),
  ah(async (req, res) => {
    const b = req.body;
    const hash = await bcrypt.hash(b.admin_password, 10);
    const id = await tx(async (c) => {
      const [t] = await c.execute('INSERT INTO tenants (name,slug) VALUES (?,?)', [b.name, b.slug]);
      const [u] = await c.execute('INSERT INTO users (tenant_id,email,password_hash,full_name) VALUES (?,?,?,?)',
        [t.insertId, b.admin_email, hash, b.admin_name]);
      await c.execute("INSERT INTO user_roles SELECT ?, id FROM roles WHERE name='admin'", [u.insertId]);
      await seedCategories(c, t.insertId); // rubros sugeridos de expensas
      return t.insertId;
    });
    res.status(201).json({ id });
  }));

r.patch('/tenants/:id', validate(z.object({ active: z.boolean() })), ah(async (req, res) => {
  await query("UPDATE tenants SET active=? WHERE id=? AND slug<>'plataforma'", [req.body.active, req.params.id]);
  res.json({ ok: true });
}));

// Emite un token para operar dentro de un complejo con permisos de admin
r.post('/tenants/:id/enter', ah(async (req, res) => {
  const [t] = await query("SELECT id,name,slug FROM tenants WHERE id=? AND slug<>'plataforma'", [req.params.id]);
  if (!t) { throw new HttpError(404, 'Complejo no encontrado'); }
  await query("INSERT INTO audit_log (tenant_id,user_id,entity,entity_id,action,ip) VALUES (?,?,'tenant',?,'superadmin_enter',?)",
    [t.id, req.user.id, t.id, req.ip]);
  res.json({ token: signToken({ id: req.user.id, tenant_id: t.id, roles: ['admin', 'superadmin'], lot_id: null }), tenant: t });
}));

export default r;
