import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../lib/db.js';
import { ah, audit, validate, HttpError, toSql } from '../lib/helpers.js';
import { requireRole, hasRole } from '../middleware/auth.js';
import { emitToUser } from '../lib/realtime.js';

const r = Router();
const ADMIN = ['admin'];
const RESIDENT = ['owner', 'family', 'resident'];

// --- Espacios ---
r.get('/spaces', ah(async (req, res) => {
  res.json(await query('SELECT * FROM spaces WHERE tenant_id=? AND active=1 ORDER BY name', [req.tenantId]));
}));

const spaceSchema = z.object({
  name: z.string().min(2), type: z.enum(['clubhouse', 'court', 'pool', 'other']),
  capacity: z.number().int().min(1).default(1), slot_minutes: z.number().int().min(15).default(60),
  open_time: z.string().regex(/^\d{2}:\d{2}$/), close_time: z.string().regex(/^\d{2}:\d{2}$/),
  max_per_lot_week: z.number().int().min(1).default(2), min_advance_hours: z.number().int().min(0).default(2),
  max_advance_days: z.number().int().min(1).default(30), requires_approval: z.boolean().default(true),
  price: z.number().min(0).default(0),
});

r.post('/spaces', requireRole(...ADMIN), validate(spaceSchema), ah(async (req, res) => {
  const b = req.body;
  const x = await query(
    `INSERT INTO spaces (tenant_id,name,type,capacity,slot_minutes,open_time,close_time,max_per_lot_week,min_advance_hours,
      max_advance_days,requires_approval,price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [req.tenantId, b.name, b.type, b.capacity, b.slot_minutes, b.open_time, b.close_time, b.max_per_lot_week,
      b.min_advance_hours, b.max_advance_days, b.requires_approval, b.price]);
  res.status(201).json({ id: x.insertId });
}));

async function getSpace(tenantId, id) {
  const [s] = await query('SELECT * FROM spaces WHERE id=? AND tenant_id=? AND active=1', [id, tenantId]);
  if (!s) { throw new HttpError(404, 'Espacio no encontrado'); }
  return s;
}

// Calendario: franjas de un día con cupos libres
r.get('/spaces/:id/availability', ah(async (req, res) => {
  const space = await getSpace(req.tenantId, req.params.id);
  const date = String(req.query.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { throw new HttpError(400, 'date=YYYY-MM-DD requerido'); }
  const taken = await query(
    `SELECT start_at,end_at FROM reservations WHERE tenant_id=? AND space_id=? AND status IN ('pending','approved')
     AND start_at < ? AND end_at > ?`, [req.tenantId, space.id, `${date} 23:59:59`, `${date} 00:00:00`]);
  const slots = [];
  const [oh, om] = space.open_time.split(':').map(Number);
  const [ch, cm] = space.close_time.split(':').map(Number);
  for (let m = oh * 60 + om; m + space.slot_minutes <= ch * 60 + cm; m += space.slot_minutes) {
    const start = `${date} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
    const e = m + space.slot_minutes;
    const end = `${date} ${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}:00`;
    const used = taken.filter((t) => t.start_at < end && t.end_at > start).length;
    slots.push({ start, end, free: Math.max(space.capacity - used, 0) });
  }
  res.json({ space, slots });
}));

// --- Reservas ---
r.get('/reservations', ah(async (req, res) => {
  const params = [req.tenantId];
  let where = 'r.tenant_id=?';
  if (!hasRole(req, ...ADMIN)) { where += ' AND r.lot_id=?'; params.push(req.user.lot_id); }
  if (req.query.status) { where += ' AND r.status=?'; params.push(req.query.status); }
  res.json(await query(
    `SELECT r.*, s.name AS space_name, l.code AS lot_code, u.full_name FROM reservations r
     JOIN spaces s ON s.id=r.space_id JOIN lots l ON l.id=r.lot_id JOIN users u ON u.id=r.user_id
     WHERE ${where} ORDER BY r.start_at DESC LIMIT 300`, params));
}));

r.post('/reservations', requireRole(...RESIDENT),
  validate(z.object({ space_id: z.number().int(), start_at: z.string() })),
  ah(async (req, res) => {
    const space = await getSpace(req.tenantId, req.body.space_id);
    const start = new Date(req.body.start_at.replace(' ', 'T'));
    if (isNaN(start)) { throw new HttpError(400, 'Fecha inválida'); }
    const end = new Date(start.getTime() + space.slot_minutes * 60000);
    const hoursAhead = (start - Date.now()) / 3600000;
    if (hoursAhead < space.min_advance_hours) { throw new HttpError(422, `Debe reservar con ${space.min_advance_hours} h de anticipación`); }
    if (hoursAhead > space.max_advance_days * 24) { throw new HttpError(422, `No se puede reservar con más de ${space.max_advance_days} días`); }
    const startSql = toSql(start); const endSql = toSql(end);
    const hhmm = startSql.slice(11, 16); const endHhmm = endSql.slice(11, 16);
    if (hhmm < space.open_time.slice(0, 5) || endHhmm > space.close_time.slice(0, 5) || endSql.slice(0, 10) !== startSql.slice(0, 10)) { throw new HttpError(422, 'Fuera del horario del espacio'); }

    const id = await tx(async (c) => {
      // Bloqueo del espacio para evitar sobre-reserva concurrente
      await c.execute('SELECT id FROM spaces WHERE id=? FOR UPDATE', [space.id]);
      const [[{ n }]] = await c.execute(
        `SELECT COUNT(*) n FROM reservations WHERE space_id=? AND status IN ('pending','approved') AND start_at<? AND end_at>?`,
        [space.id, endSql, startSql]);
      if (n >= space.capacity) { throw new HttpError(409, 'Sin cupo en esa franja'); }
      const [[{ w }]] = await c.execute(
        `SELECT COUNT(*) w FROM reservations WHERE space_id=? AND lot_id=? AND status IN ('pending','approved')
         AND YEARWEEK(start_at,1)=YEARWEEK(?,1)`, [space.id, req.user.lot_id, startSql]);
      if (w >= space.max_per_lot_week) { throw new HttpError(422, `Máximo ${space.max_per_lot_week} reservas por semana para este espacio`); }
      const price = Number(space.price);
      const [x] = await c.execute(
        `INSERT INTO reservations (tenant_id,space_id,lot_id,user_id,start_at,end_at,status,payment_status,amount)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [req.tenantId, space.id, req.user.lot_id, req.user.id, startSql, endSql,
          space.requires_approval ? 'pending' : 'approved', price > 0 ? 'pending' : 'not_required', price]);
      return x.insertId;
    });
    await audit(req, 'reservation', id, 'create', req.body);
    res.status(201).json({ id, requires_payment: Number(space.price) > 0 });
  }));

r.post('/reservations/:id/review', requireRole(...ADMIN),
  validate(z.object({ approve: z.boolean(), note: z.string().max(255).optional() })),
  ah(async (req, res) => {
    const [rv] = await query("SELECT * FROM reservations WHERE id=? AND tenant_id=? AND status='pending'", [req.params.id, req.tenantId]);
    if (!rv) { throw new HttpError(404, 'Reserva no encontrada o ya resuelta'); }
    const status = req.body.approve ? 'approved' : 'rejected';
    await query('UPDATE reservations SET status=?, reviewed_by=?, review_note=? WHERE id=?', [status, req.user.id, req.body.note ?? null, rv.id]);
    emitToUser(rv.user_id, 'reservation:updated', { id: rv.id, status });
    await audit(req, 'reservation', rv.id, status, req.body);
    res.json({ ok: true });
  }));

r.post('/reservations/:id/cancel', ah(async (req, res) => {
  const [rv] = await query("SELECT * FROM reservations WHERE id=? AND tenant_id=? AND status IN ('pending','approved')", [req.params.id, req.tenantId]);
  if (!rv) { throw new HttpError(404, 'Reserva no encontrada'); }
  if (!hasRole(req, ...ADMIN) && rv.lot_id !== req.user.lot_id) { throw new HttpError(403, 'Permiso denegado'); }
  await query("UPDATE reservations SET status='cancelled' WHERE id=?", [rv.id]);
  await audit(req, 'reservation', rv.id, 'cancelled');
  res.json({ ok: true });
}));

export default r;
