import { z } from 'zod';
import { defineModel, count } from '../lib/crud.js';
import { HttpError } from '../lib/helpers.js';
import { zLat, zLng } from '../lib/geo.js';

export const checkpoints = defineModel({
  path: 'checkpoints',
  table: 'checkpoints',
  label: 'Punto de control',
  entity: 'checkpoint',
  editRoles: ['supervisor', 'admin'],
  update: z.object({
    name: z.string().trim().min(1).max(80),
    tag_code: z.string().trim().min(4, 'Mínimo 4 caracteres').max(64),
    sort_order: z.number().int(),
    active: z.boolean(),
    lat: zLat.nullable(),
    lng: zLng.nullable(),
    radius_m: z.number().int().min(5, 'Mínimo 5 m').max(1000, 'Máximo 1000 m'),
  }).partial(),
  // La ubicación se edita completa: un punto con una sola coordenada no se podría validar
  beforeUpdate: async (c, row, b) => {
    const lat = b.lat !== undefined ? b.lat : row.lat;
    const lng = b.lng !== undefined ? b.lng : row.lng;
    if ((lat == null) !== (lng == null)) { throw new HttpError(400, 'Cargue latitud y longitud juntas'); }
    return b;
  },
  dependencies: async (c, row) => [
    { label: 'marcas en rondas', count: await count(c, 'SELECT COUNT(*) n FROM round_points WHERE checkpoint_id=?', [row.id]) },
    { label: 'intentos de escaneo auditados', count: await count(c, 'SELECT COUNT(*) n FROM round_scans WHERE checkpoint_id=?', [row.id]) },
  ],
  cascade: (c, row) => c.execute('DELETE FROM round_points WHERE checkpoint_id=?', [row.id]),
});

export const rounds = defineModel({
  path: 'rounds',
  table: 'rounds',
  label: 'Ronda',
  entity: 'round',
  editRoles: ['supervisor', 'admin'],
  update: z.object({
    status: z.enum(['in_progress', 'completed', 'incomplete']),
    expected_minutes: z.number().int().min(5).max(480),
  }).partial(),
  // round_points se elimina por ON DELETE CASCADE
});
