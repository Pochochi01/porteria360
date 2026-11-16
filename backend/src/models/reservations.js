import { z } from 'zod';
import { defineModel, count, zTime, zOptText } from '../lib/crud.js';
import { HttpError } from '../lib/helpers.js';

export const spaces = defineModel({
  path: 'spaces',
  table: 'spaces',
  label: 'Espacio',
  entity: 'space',
  editRoles: ['admin'],
  update: z.object({
    name: z.string().trim().min(2).max(80),
    type: z.enum(['clubhouse', 'court', 'pool', 'other']),
    capacity: z.number().int().min(1),
    slot_minutes: z.number().int().min(15),
    open_time: zTime,
    close_time: zTime,
    max_per_lot_week: z.number().int().min(1),
    min_advance_hours: z.number().int().min(0),
    max_advance_days: z.number().int().min(1),
    requires_approval: z.boolean(),
    price: z.number().min(0),
    active: z.boolean(),
  }).partial(),
  beforeUpdate: (c, row, b) => {
    const open = (b.open_time ?? row.open_time).slice(0, 5);
    const close = (b.close_time ?? row.close_time).slice(0, 5);
    if (open >= close) { throw new HttpError(400, 'El horario de apertura debe ser anterior al de cierre'); }
    return b;
  },
  dependencies: async (c, row) => [
    { label: 'reservas', count: await count(c, 'SELECT COUNT(*) n FROM reservations WHERE space_id=?', [row.id]) },
  ],
  cascade: (c, row) => c.execute('DELETE FROM reservations WHERE space_id=?', [row.id]),
});

export const reservations = defineModel({
  path: 'reservations',
  table: 'reservations',
  label: 'Reserva',
  entity: 'reservation',
  editRoles: ['admin'],
  update: z.object({
    status: z.enum(['pending', 'approved', 'rejected', 'cancelled']),
    payment_status: z.enum(['not_required', 'pending', 'approved', 'rejected', 'refunded']),
    review_note: zOptText(255),
  }).partial(),
});
