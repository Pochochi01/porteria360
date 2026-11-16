import { Router } from 'express';
import { mountModel, registry } from '../lib/crud.js';
import '../models/tenants.js';
import '../models/users.js';
import '../models/lots.js';
import '../models/visits.js';
import '../models/rounds.js';
import '../models/expenses.js';
import '../models/reservations.js';
import '../models/incidents.js';
import '../models/finance.js';

// PUT /:id y DELETE /:id de todos los modelos (requiere authenticate antes)
const r = Router();
for (const m of registry) { mountModel(r, m); }
export default r;
