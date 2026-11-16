import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { defineModel, count, zOptText } from '../lib/crud.js';
import { HttpError } from '../lib/helpers.js';

const ROLES = ['admin', 'supervisor', 'guard', 'owner', 'family', 'resident'];

async function assertLot(c, lotId, tenantId) {
  if (lotId == null) { return; }
  const [r] = await c.execute('SELECT id FROM lots WHERE id=? AND tenant_id=?', [lotId, tenantId]);
  if (!r.length) { throw new HttpError(400, 'Lote inexistente'); }
}

async function setRole(c, user, role, tenantId) {
  await c.execute('DELETE FROM user_roles WHERE user_id=?', [user.id]);
  await c.execute('INSERT INTO user_roles SELECT ?, id FROM roles WHERE name=?', [user.id, role]);
  if (role === 'guard') { await c.execute('INSERT IGNORE INTO guards (tenant_id,user_id) VALUES (?,?)', [tenantId, user.id]); }
}

/** Borra los datos que dependen de un usuario (y, recursivamente, de su grupo familiar). */
async function cascadeUser(c, userId) {
  const [children] = await c.execute('SELECT id FROM users WHERE parent_user_id=?', [userId]);
  for (const ch of children) {
    await cascadeUser(c, ch.id);
    await c.execute('DELETE FROM users WHERE id=?', [ch.id]);
  }
  await c.execute('DELETE r FROM rounds r JOIN guards g ON g.id=r.guard_id WHERE g.user_id=?', [userId]); // round_points en cascada
  await c.execute('DELETE FROM guards WHERE user_id=?', [userId]);
  await c.execute('DELETE FROM reservations WHERE user_id=?', [userId]);
  await c.execute('DELETE FROM incidents WHERE reported_by=?', [userId]);
}

const userDeps = async (c, row) => [
  { label: 'familiares/residentes a cargo', count: await count(c, 'SELECT COUNT(*) n FROM users WHERE parent_user_id=?', [row.id]) },
  { label: 'rondas registradas', count: await count(c, 'SELECT COUNT(*) n FROM rounds r JOIN guards g ON g.id=r.guard_id WHERE g.user_id=?', [row.id]) },
  { label: 'reservas', count: await count(c, 'SELECT COUNT(*) n FROM reservations WHERE user_id=?', [row.id]) },
  { label: 'incidentes reportados', count: await count(c, 'SELECT COUNT(*) n FROM incidents WHERE reported_by=?', [row.id]) },
];

const base = {
  full_name: z.string().trim().min(2, 'Mínimo 2 caracteres').max(120),
  email: z.string().trim().email('Email inválido').transform((e) => e.toLowerCase()),
  dni: zOptText(20),
  phone: zOptText(30),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
  active: z.boolean(),
};

async function prepare(c, row, b, req, allowedRoles) {
  const { role, password, ...cols } = b;
  if (password) { cols.password_hash = await bcrypt.hash(password, 10); }
  if ('lot_id' in cols) { await assertLot(c, cols.lot_id, req.tenantId); }
  if (role) {
    if (!allowedRoles.includes(role)) { throw new HttpError(400, 'Rol no permitido'); }
    if (role === 'owner' && !(cols.lot_id ?? row.lot_id)) { throw new HttpError(400, 'El propietario requiere lote'); }
    await setRole(c, row, role, req.tenantId);
  }
  return cols;
}

export const users = defineModel({
  path: 'users',
  table: 'users',
  label: 'Usuario',
  entity: 'user',
  editRoles: ['admin'],
  hidden: ['password_hash'],
  update: z.object({ ...base, lot_id: z.number().int().nullable(), role: z.enum(ROLES) }).partial(),
  canAccess: (row, req) => {
    if (row.id === req.user.id && req.method === 'DELETE') { throw new HttpError(400, 'No puede eliminar su propio usuario'); }
  },
  beforeUpdate: (c, row, b, req) => {
    if (row.id === req.user.id && (b.active === false || (b.role && b.role !== 'admin'))) { throw new HttpError(400, 'No puede desactivarse ni quitarse el rol de administrador a sí mismo'); }
    return prepare(c, row, b, req, ROLES);
  },
  dependencies: userDeps,
  cascade: (c, row) => cascadeUser(c, row.id),
});

// El propietario edita a su grupo familiar (no puede eliminar: solo administradores)
export const household = defineModel({
  path: 'household',
  table: 'users',
  label: 'Familiar',
  entity: 'user',
  editRoles: ['owner'],
  deleteRoles: null,
  hidden: ['password_hash'],
  update: z.object({ ...base, role: z.enum(['family', 'resident']) }).partial(),
  canAccess: (row, req) => {
    if (row.parent_user_id !== req.user.id) { throw new HttpError(404, 'Familiar no encontrado'); }
  },
  beforeUpdate: (c, row, b, req) => prepare(c, row, b, req, ['family', 'resident']),
});
