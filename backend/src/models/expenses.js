import { z } from 'zod';
import { defineModel, count, zDate, zOptText } from '../lib/crud.js';
import { HttpError } from '../lib/helpers.js';

export const settlements = defineModel({
  path: 'expenses',
  table: 'expense_settlements',
  label: 'Liquidación',
  entity: 'expense_settlement',
  editRoles: ['admin'],
  update: z.object({
    lot_id: z.number().int(),
    period: z.string().regex(/^\d{4}-\d{2}$/, 'Formato AAAA-MM'),
    amount: z.number().positive('El importe debe ser mayor a 0'),
    due_date: zDate,
    detail: zOptText(500),
  }).partial(),
  beforeUpdate: async (c, row, b, req) => {
    // El importe es la base de la regla "sin pagos parciales": no se toca si ya hay un pago informado
    if (row.status !== 'pending' && ('amount' in b || 'lot_id' in b || 'period' in b)) { throw new HttpError(409, 'La liquidación ya tiene un pago informado; solo se puede cambiar vencimiento y detalle'); }
    if ('lot_id' in b) {
      const [l] = await c.execute('SELECT id FROM lots WHERE id=? AND tenant_id=?', [b.lot_id, req.tenantId]);
      if (!l.length) { throw new HttpError(400, 'Lote inexistente'); }
    }
    return b;
  },
  dependencies: async (c, row) => [
    { label: 'pagos registrados', count: await count(c, 'SELECT COUNT(*) n FROM expense_payments WHERE settlement_id=?', [row.id]) },
  ],
  cascade: async (c, row) => {
    const [files] = await c.execute('SELECT receipt_path FROM expense_payments WHERE settlement_id=?', [row.id]);
    await c.execute('DELETE FROM expense_payments WHERE settlement_id=?', [row.id]);
    return { files: files.map((f) => f.receipt_path) };
  },
});

export const payments = defineModel({
  path: 'expenses/payments',
  table: 'expense_payments',
  label: 'Pago',
  entity: 'expense_payment',
  editRoles: ['admin'],
  update: z.object({ receipt_number: zOptText(30), method: z.enum(['transfer', 'cash']) }).partial(),
  cascade: (c, row) => ({ files: [row.receipt_path] }),
  // Recalcula el estado de la liquidación según los pagos que quedan
  afterDelete: async (c, row) => {
    const approved = await count(c, "SELECT COUNT(*) n FROM expense_payments WHERE settlement_id=? AND status='approved'", [row.settlement_id]);
    const pending = await count(c, "SELECT COUNT(*) n FROM expense_payments WHERE settlement_id=? AND status='pending'", [row.settlement_id]);
    await c.execute('UPDATE expense_settlements SET status=? WHERE id=?',
      [approved ? 'paid' : pending ? 'in_review' : 'pending', row.settlement_id]);
  },
});
