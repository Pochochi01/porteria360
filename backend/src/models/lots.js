import { z } from 'zod';
import { defineModel, count, zOptText } from '../lib/crud.js';

export default defineModel({
  path: 'lots',
  table: 'lots',
  label: 'Lote',
  entity: 'lot',
  editRoles: ['admin'],
  update: z.object({
    code: z.string().trim().min(1).max(30), address: zOptText(160),
    // Bases de prorrateo de expensas (lib/expenseEngine.js)
    surface_m2: z.number().positive().max(10000000).nullable(),
    coefficient: z.number().positive().max(1000000).nullable(),
    share_pct: z.number().positive().max(100).nullable(),
  }).partial(),
  dependencies: async (c, row) => [
    // Los usuarios no se borran en cascada con el lote: hay que reasignarlos o eliminarlos antes
    { label: 'usuarios asignados', count: await count(c, 'SELECT COUNT(*) n FROM users WHERE lot_id=?', [row.id]), block: true },
    { label: 'visitas', count: await count(c, 'SELECT COUNT(*) n FROM visits WHERE lot_id=?', [row.id]) },
    { label: 'liquidaciones de expensas', count: await count(c, 'SELECT COUNT(*) n FROM expense_settlements WHERE lot_id=?', [row.id]) },
    { label: 'reservas', count: await count(c, 'SELECT COUNT(*) n FROM reservations WHERE lot_id=?', [row.id]) },
  ],
  cascade: async (c, row) => {
    const [files] = await c.execute(
      'SELECT p.receipt_path FROM expense_payments p JOIN expense_settlements s ON s.id=p.settlement_id WHERE s.lot_id=?', [row.id]);
    await c.execute('DELETE p FROM expense_payments p JOIN expense_settlements s ON s.id=p.settlement_id WHERE s.lot_id=?', [row.id]);
    await c.execute('DELETE FROM expense_settlements WHERE lot_id=?', [row.id]);
    await c.execute('DELETE FROM visits WHERE lot_id=?', [row.id]);
    await c.execute('DELETE FROM reservations WHERE lot_id=?', [row.id]);
    await c.execute('UPDATE incidents SET lot_id=NULL WHERE lot_id=?', [row.id]);
    return { files: files.map((f) => f.receipt_path) };
  },
});
