import { z } from 'zod';
import { defineModel, zDateTime, zOptText } from '../lib/crud.js';

export default defineModel({
  path: 'visits',
  table: 'visits',
  label: 'Visita',
  entity: 'visit',
  // La guardia registra movimientos (ingreso, egreso, rechazo) pero no edita invitaciones ni el historial
  editRoles: ['supervisor', 'admin'],
  update: z.object({
    visitor_name: z.string().trim().min(2).max(120),
    visitor_dni: zOptText(20),
    vehicle_plate: zOptText(15),
    type: z.enum(['visit', 'delivery', 'service', 'worker']),
    status: z.enum(['pending', 'authorized', 'rejected', 'inside', 'exited', 'expired', 'cancelled']),
    valid_from: zDateTime.nullable(),
    valid_until: zDateTime.nullable(),
    notes: zOptText(255),
  }).partial(),
});
