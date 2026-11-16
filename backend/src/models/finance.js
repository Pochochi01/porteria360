// Modelos del módulo de gastos y expensas: PUT/DELETE, auditoría y OpenAPI salen de lib/crud.js.
import { z } from 'zod';
import { defineModel, count, zDate, zOptText } from '../lib/crud.js';
import { HttpError } from '../lib/helpers.js';
import { removeAsset } from '../lib/files.js';

export const VOUCHER_TYPES = ['Factura A', 'Factura B', 'Factura C', 'Recibo', 'Ticket', 'Nota de crédito', 'Nota de débito', 'Otro'];
export const zCuit = z.string().trim().transform((s) => s.replace(/\D/g, ''))
  .pipe(z.string().regex(/^\d{11}$/, 'El CUIT debe tener 11 dígitos'));
export const PAYMENT_TYPES = ['transfer', 'mercadopago', 'modo', 'naranjax'];

/** Datos de cada tipo de medio de pago (lo que ve el propietario). */
export const paymentData = {
  transfer: z.object({
    alias: zOptText(60).optional(), cbu: z.string().trim().regex(/^\d{22}$/, 'El CBU/CVU tiene 22 dígitos').or(z.literal('')).optional(),
    bank: zOptText(80).optional(), holder: zOptText(120).optional(), cuit: zOptText(13).optional(),
  }).strict(),
  wallet: z.object({
    url: z.string().trim().url('URL inválida').refine((u) => u.startsWith('https://'), 'Debe ser https').or(z.literal('')).optional(),
    qr_text: zOptText(500).optional(), alias: zOptText(60).optional(),
  }).strict(),
};
export const dataSchemaFor = (type) => (type === 'transfer' ? paymentData.transfer : paymentData.wallet);

async function assertOwned(c, table, id, tenantId, label) {
  if (id == null) { return; }
  const [r] = await c.execute(`SELECT id FROM ${table} WHERE id=? AND tenant_id=?`, [id, tenantId]);
  if (!r.length) { throw new HttpError(400, `${label} inexistente`); }
}

export const categories = defineModel({
  path: 'expense-categories',
  table: 'expense_categories',
  label: 'Rubro',
  entity: 'expense_category',
  editRoles: ['admin'],
  update: z.object({ name: z.string().trim().min(2).max(60), sort_order: z.number().int(), active: z.boolean() }).partial(),
  dependencies: async (c, row) => [
    // Un rubro con gastos no se borra (se desactiva): los gastos y reportes históricos lo necesitan
    { label: 'gastos cargados', count: await count(c, 'SELECT COUNT(*) n FROM expenditures WHERE category_id=?', [row.id]), block: true },
  ],
});

export const suppliers = defineModel({
  path: 'suppliers',
  table: 'suppliers',
  label: 'Proveedor',
  entity: 'supplier',
  editRoles: ['admin'],
  update: z.object({
    legal_name: z.string().trim().min(2).max(160), trade_name: zOptText(160), cuit: zCuit.nullable(),
    email: z.string().trim().email('Email inválido').or(z.literal('')).nullable().transform((s) => s || null),
    phone: zOptText(30), address: zOptText(200), active: z.boolean(),
  }).partial(),
  dependencies: async (c, row) => [
    { label: 'gastos cargados', count: await count(c, 'SELECT COUNT(*) n FROM expenditures WHERE supplier_id=?', [row.id]), block: true },
  ],
});

export const expenditures = defineModel({
  path: 'expenditures',
  table: 'expenditures',
  label: 'Gasto',
  entity: 'expenditure',
  editRoles: ['admin'],
  update: z.object({
    date: zDate, category_id: z.number().int(), supplier_id: z.number().int().nullable(),
    concept: z.string().trim().min(2).max(200), amount: z.number().positive('El importe debe ser mayor a 0'),
    voucher_type: z.enum(VOUCHER_TYPES).nullable(), voucher_number: zOptText(40), notes: zOptText(500),
  }).partial(),
  beforeUpdate: async (c, row, b, req) => {
    await assertOwned(c, 'expense_categories', b.category_id, req.tenantId, 'Rubro');
    await assertOwned(c, 'suppliers', b.supplier_id, req.tenantId, 'Proveedor');
    return b.date ? { ...b, period: b.date.slice(0, 7) } : b; // el período sigue a la fecha
  },
  // El comprobante (archivo privado) se borra junto con el gasto
  afterDelete: async (c, row) => { if (row.asset_id) { await removeAsset(row.tenant_id, row.asset_id, c); } },
});

export const paymentMethods = defineModel({
  path: 'payment-methods',
  table: 'payment_methods',
  label: 'Medio de pago',
  entity: 'payment_method',
  editRoles: ['admin'],
  update: z.object({ label: z.string().trim().min(2).max(80), data: z.record(z.any()), active: z.boolean(), sort_order: z.number().int() }).partial(),
  beforeUpdate: (c, row, b) => {
    if (!b.data) { return b; }
    const r = dataSchemaFor(row.type).safeParse(b.data);
    if (!r.success) { throw new HttpError(400, `Datos inválidos: ${r.error.issues.map((i) => `${i.path.join('.')} → ${i.message}`).join('; ')}`); }
    return { ...b, data: JSON.stringify(r.data) };
  },
});
