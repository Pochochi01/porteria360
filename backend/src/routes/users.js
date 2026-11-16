import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, tx } from '../lib/db.js';
import { ah, audit, validate, HttpError } from '../lib/helpers.js';
import { requireRole } from '../middleware/auth.js';

const r = Router();

const userSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  password: z.string().min(8),
  full_name: z.string().min(2).max(120),
  dni: z.string().max(20).optional(),
  phone: z.string().max(30).optional(),
  lot_id: z.number().int().optional(),
});

async function createUser(req, data, role, parentId = null) {
  return tx(async (conn) => {
    if (data.lot_id) {
      const [lot] = await conn.execute('SELECT id FROM lots WHERE id=? AND tenant_id=?', [data.lot_id, req.tenantId]);
      if (!lot.length) { throw new HttpError(400, 'Lote inexistente'); }
    }
    const hash = await bcrypt.hash(data.password, 10);
    const [res] = await conn.execute(
      `INSERT INTO users (tenant_id,email,password_hash,full_name,dni,phone,lot_id,parent_user_id) VALUES (?,?,?,?,?,?,?,?)`,
      [req.tenantId, data.email, hash, data.full_name, data.dni ?? null, data.phone ?? null, data.lot_id ?? null, parentId]
    );
    await conn.execute('INSERT INTO user_roles SELECT ?, id FROM roles WHERE name=?', [res.insertId, role]);
    if (role === 'guard') { await conn.execute('INSERT INTO guards (tenant_id,user_id) VALUES (?,?)', [req.tenantId, res.insertId]); }
    return res.insertId;
  });
}

// --- Lotes (admin) ---
r.get('/lots', ah(async (req, res) => {
  res.json(await query('SELECT * FROM lots WHERE tenant_id=? ORDER BY code', [req.tenantId]));
}));

r.post('/lots', requireRole('admin'),
  validate(z.object({ code: z.string().min(1).max(30), address: z.string().max(160).optional() })),
  ah(async (req, res) => {
    const x = await query('INSERT INTO lots (tenant_id,code,address) VALUES (?,?,?)', [req.tenantId, req.body.code, req.body.address ?? null]);
    await audit(req, 'lot', x.insertId, 'create', req.body);
    res.status(201).json({ id: x.insertId });
  }));

// --- Usuarios (admin: propietarios/guardias) ---
r.get('/users', requireRole('admin', 'supervisor'), ah(async (req, res) => {
  res.json(await query(
    `SELECT u.id,u.email,u.full_name,u.dni,u.phone,u.lot_id,l.code AS lot_code,u.active,u.parent_user_id,
            GROUP_CONCAT(DISTINCT ro.name) AS roles,
            (SELECT GROUP_CONCAT(x.code ORDER BY x.code) FROM user_lots ul JOIN lots x ON x.id=ul.lot_id
              WHERE ul.user_id=u.id AND ul.lot_id<>COALESCE(u.lot_id,0)) AS extra_lots
     FROM users u LEFT JOIN lots l ON l.id=u.lot_id
     LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles ro ON ro.id=ur.role_id
     WHERE u.tenant_id=? GROUP BY u.id ORDER BY u.full_name`, [req.tenantId]));
}));

r.post('/users', requireRole('admin'),
  validate(userSchema.extend({ role: z.enum(['owner', 'guard', 'supervisor', 'admin']) })),
  ah(async (req, res) => {
    const { role, ...data } = req.body;
    if (role === 'owner' && !data.lot_id) { throw new HttpError(400, 'El propietario requiere lote'); }
    const id = await createUser(req, data, role);
    await audit(req, 'user', id, 'create', { role, email: data.email });
    res.status(201).json({ id });
  }));

// Reseteo de contraseña de cualquier usuario del complejo (solo admin)
r.post('/users/:id/password', requireRole('admin'),
  validate(z.object({ password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(72) })),
  ah(async (req, res) => {
    const hash = await bcrypt.hash(req.body.password, 10);
    const x = await query('UPDATE users SET password_hash=? WHERE id=? AND tenant_id=?', [hash, req.params.id, req.tenantId]);
    if (!x.affectedRows) { throw new HttpError(404, 'Usuario no encontrado'); }
    await audit(req, 'user', Number(req.params.id), 'password_reset');
    res.json({ ok: true });
  }));

r.patch('/users/:id', requireRole('admin'),
  validate(z.object({ active: z.boolean().optional(), full_name: z.string().optional(), phone: z.string().optional(), lot_id: z.number().int().nullable().optional() })),
  ah(async (req, res) => {
    const fields = Object.keys(req.body);
    if (!fields.length) { return res.json({ ok: true }); }
    await query(`UPDATE users SET ${fields.map((f) => `${f}=?`).join(',')} WHERE id=? AND tenant_id=?`,
      [...fields.map((f) => req.body[f]), req.params.id, req.tenantId]);
    await audit(req, 'user', req.params.id, 'update', req.body);
    res.json({ ok: true });
  }));

// --- Lotes de un propietario (puede tener varios; users.lot_id sigue siendo el principal) ---
r.get('/users/:id/lots', requireRole('admin'), ah(async (req, res) => {
  const [u] = await query('SELECT id, lot_id FROM users WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
  if (!u) { throw new HttpError(404, 'Usuario no encontrado'); }
  const rows = await query('SELECT lot_id FROM user_lots WHERE user_id=? AND tenant_id=?', [u.id, req.tenantId]);
  res.json({ primary: u.lot_id, lot_ids: [...new Set([u.lot_id, ...rows.map((x) => x.lot_id)].filter(Boolean))] });
}));

r.put('/users/:id/lots', requireRole('admin'), validate(z.object({ lot_ids: z.array(z.number().int()).max(200) })), ah(async (req, res) => {
  const [u] = await query(
    `SELECT u.id, u.lot_id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles ro ON ro.id=ur.role_id
     WHERE u.id=? AND u.tenant_id=? AND ro.name='owner'`, [req.params.id, req.tenantId]);
  if (!u) { throw new HttpError(404, 'Propietario no encontrado'); }
  const ids = [...new Set([u.lot_id, ...req.body.lot_ids].filter(Boolean))]; // el lote principal siempre queda
  if (ids.length) {
    const [{ n }] = await query(`SELECT COUNT(*) n FROM lots WHERE tenant_id=? AND id IN (${ids.map(() => '?').join(',')})`, [req.tenantId, ...ids]);
    if (Number(n) !== ids.length) { throw new HttpError(400, 'Algún lote no existe en este complejo'); }
  }
  await tx(async (c) => {
    await c.execute('DELETE FROM user_lots WHERE user_id=? AND tenant_id=?', [u.id, req.tenantId]);
    for (const id of ids) { await c.execute('INSERT INTO user_lots (user_id, lot_id, tenant_id) VALUES (?,?,?)', [u.id, id, req.tenantId]); }
  });
  await audit(req, 'user', u.id, 'lots_update', { lot_ids: ids });
  res.json({ primary: u.lot_id, lot_ids: ids });
}));

// --- Familiares/residentes (propietario) ---
r.get('/household', requireRole('owner'), ah(async (req, res) => {
  res.json(await query(
    `SELECT u.id,u.email,u.full_name,u.dni,u.phone,u.active,GROUP_CONCAT(ro.name) AS roles
     FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles ro ON ro.id=ur.role_id
     WHERE u.tenant_id=? AND u.parent_user_id=? GROUP BY u.id`, [req.tenantId, req.user.id]));
}));

r.post('/household', requireRole('owner'),
  validate(userSchema.omit({ lot_id: true }).extend({ role: z.enum(['family', 'resident']) })),
  ah(async (req, res) => {
    const { role, ...data } = req.body;
    // El familiar hereda el lote del propietario (tomado del token, no del cliente)
    const id = await createUser(req, { ...data, lot_id: req.user.lot_id }, role, req.user.id);
    await audit(req, 'user', id, 'create_household', { role });
    res.status(201).json({ id });
  }));

r.patch('/household/:id', requireRole('owner'), validate(z.object({ active: z.boolean() })), ah(async (req, res) => {
  const x = await query('UPDATE users SET active=? WHERE id=? AND tenant_id=? AND parent_user_id=?',
    [req.body.active, req.params.id, req.tenantId, req.user.id]);
  if (!x.affectedRows) { throw new HttpError(404, 'No encontrado'); }
  await audit(req, 'user', req.params.id, req.body.active ? 'enable' : 'disable');
  res.json({ ok: true });
}));

// --- Perfil propio ---
r.patch('/profile', validate(z.object({ full_name: z.string().min(2).optional(), phone: z.string().max(30).optional(),
  password: z.string().min(8).optional() })), ah(async (req, res) => {
  const { password, ...rest } = req.body;
  if (password) { rest.password_hash = await bcrypt.hash(password, 10); }
  const f = Object.keys(rest);
  if (f.length) {
 await query(`UPDATE users SET ${f.map((k) => `${k}=?`).join(',')} WHERE id=? AND tenant_id=?`,
    [...f.map((k) => rest[k]), req.user.id, req.tenantId]);
}
  res.json({ ok: true });
}));

export default r;
