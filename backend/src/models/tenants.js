import { z } from 'zod';
import { defineModel, count } from '../lib/crud.js';
import { removeTenantFiles } from '../lib/files.js';
import { HttpError } from '../lib/helpers.js';

export const toSlug = (s) =>
  s.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const T = 'tenant_id=?';

export default defineModel({
  path: 'platform/tenants',
  table: 'tenants',
  label: 'Complejo',
  entity: 'tenant',
  tenantScoped: false,
  editRoles: ['superadmin'],
  deleteRoles: ['superadmin'],
  hidden: ['mp_access_token', 'mp_refresh_token'],
  update: z.object({
    name: z.string().trim().min(2, 'Mínimo 2 caracteres').max(120),
    slug: z.string().transform(toSlug)
      .pipe(z.string().min(2, 'Mínimo 2 caracteres').max(60).refine((s) => s !== 'plataforma', 'Identificador reservado')),
    active: z.boolean(),
  }).partial(),
  canAccess: (row) => {
    if (row.slug === 'plataforma') { throw new HttpError(403, 'El tenant de plataforma no se puede modificar'); }
  },
  dependencies: async (c, row) => [
    { label: 'lotes', count: await count(c, `SELECT COUNT(*) n FROM lots WHERE ${T}`, [row.id]) },
    { label: 'usuarios', count: await count(c, `SELECT COUNT(*) n FROM users WHERE ${T}`, [row.id]) },
    { label: 'visitas', count: await count(c, `SELECT COUNT(*) n FROM visits WHERE ${T}`, [row.id]) },
    { label: 'liquidaciones de expensas', count: await count(c, `SELECT COUNT(*) n FROM expense_settlements WHERE ${T}`, [row.id]) },
    { label: 'reservas', count: await count(c, `SELECT COUNT(*) n FROM reservations WHERE ${T}`, [row.id]) },
    { label: 'incidentes', count: await count(c, `SELECT COUNT(*) n FROM incidents WHERE ${T}`, [row.id]) },
  ],
  // Borra todo el complejo respetando el orden de las claves foráneas
  cascade: async (c, row) => {
    const id = row.id;
    const [files] = await c.execute(`SELECT receipt_path FROM expense_payments WHERE ${T} AND receipt_path IS NOT NULL`, [id]);
    await c.execute(`DELETE rp FROM round_points rp JOIN rounds r ON r.id=rp.round_id WHERE r.${T}`, [id]);
    for (const t of ['tenant_settings', 'tenant_gallery', 'tenant_assets']) { await c.execute(`DELETE FROM ${t} WHERE ${T}`, [id]); }
    for (const t of ['rounds', 'guards', 'checkpoints', 'expense_payments', 'expense_settlements', 'expenditures', 'expense_runs', 'payment_methods', 'suppliers', 'expense_categories', 'reservations', 'spaces',
      'visits', 'incidents', 'notifications', 'notification_preferences', 'announcements', 'push_subscriptions', 'audit_log']) { await c.execute(`DELETE FROM ${t} WHERE ${T}`, [id]); }
    await c.execute(`UPDATE users SET parent_user_id=NULL WHERE ${T}`, [id]);
    await c.execute(`DELETE FROM users WHERE ${T}`, [id]); // user_roles cae por ON DELETE CASCADE
    await c.execute(`DELETE FROM lots WHERE ${T}`, [id]);
    return { files: files.map((f) => f.receipt_path) };
  },
  // Archivos del complejo: branding (públicos) y comprobantes (privados)
  afterDelete: (c, row) => removeTenantFiles(row.id),
});
