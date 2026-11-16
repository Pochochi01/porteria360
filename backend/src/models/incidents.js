import { z } from 'zod';
import { defineModel, zOptText } from '../lib/crud.js';

export default defineModel({
  path: 'incidents',
  table: 'incidents',
  label: 'Incidente',
  entity: 'incident',
  editRoles: ['guard', 'supervisor', 'admin'],
  update: z.object({
    type: z.enum(['medical', 'security']),
    status: z.enum(['open', 'acknowledged', 'resolved']),
    description: zOptText(500),
    resolution: zOptText(500),
  }).partial(),
});
