import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../lib/db.js';
import { ah, audit, validate, HttpError, nowSql } from '../lib/helpers.js';
import { requireRole } from '../middleware/auth.js';
import { emitToRoles } from '../lib/realtime.js';
import { publish } from '../notifications/events.js';

const r = Router();
const SUP = ['supervisor', 'admin'];

async function guardOf(req) {
  const [g] = await query('SELECT id FROM guards WHERE user_id=? AND tenant_id=?', [req.user.id, req.tenantId]);
  if (!g) { throw new HttpError(403, 'El usuario no es guardia'); }
  return g.id;
}

async function roundDetail(tenantId, roundId) {
  const [round] = await query(
    `SELECT r.*, u.full_name AS guard_name FROM rounds r JOIN guards g ON g.id=r.guard_id JOIN users u ON u.id=g.user_id
     WHERE r.id=? AND r.tenant_id=?`, [roundId, tenantId]);
  if (!round) { return null; }
  round.points = await query(
    `SELECT rp.*, c.name FROM round_points rp JOIN checkpoints c ON c.id=rp.checkpoint_id
     WHERE rp.round_id=? ORDER BY rp.sort_order`, [roundId]);
  return round;
}

// --- Puntos de control (supervisor) ---
r.get('/checkpoints', ah(async (req, res) => {
  res.json(await query('SELECT * FROM checkpoints WHERE tenant_id=? AND active=1 ORDER BY sort_order', [req.tenantId]));
}));

r.post('/checkpoints', requireRole(...SUP),
  validate(z.object({ name: z.string().min(1), tag_code: z.string().min(4).max(64), sort_order: z.number().int().default(0) })),
  ah(async (req, res) => {
    const x = await query('INSERT INTO checkpoints (tenant_id,name,tag_code,sort_order) VALUES (?,?,?,?)',
      [req.tenantId, req.body.name, req.body.tag_code, req.body.sort_order]);
    res.status(201).json({ id: x.insertId });
  }));

// --- Guardia ---
r.post('/rounds/start', requireRole('guard'), validate(z.object({ expected_minutes: z.number().int().min(5).max(480).default(60) })),
  ah(async (req, res) => {
    const guardId = await guardOf(req);
    const [open] = await query("SELECT id FROM rounds WHERE guard_id=? AND status='in_progress'", [guardId]);
    if (open) { throw new HttpError(409, 'Ya hay una ronda en curso'); }
    const id = await tx(async (c) => {
      const [x] = await c.execute("INSERT INTO rounds (tenant_id,guard_id,started_at,expected_minutes) VALUES (?,?,?,?)",
        [req.tenantId, guardId, nowSql(), req.body.expected_minutes]);
      const [cps] = await c.execute('SELECT id,sort_order FROM checkpoints WHERE tenant_id=? AND active=1', [req.tenantId]);
      if (!cps.length) { throw new HttpError(400, 'No hay puntos de control configurados'); }
      for (const cp of cps) { await c.execute('INSERT INTO round_points (round_id,checkpoint_id,sort_order) VALUES (?,?,?)', [x.insertId, cp.id, cp.sort_order]); }
      return x.insertId;
    });
    const round = await roundDetail(req.tenantId, id);
    emitToRoles(req.tenantId, SUP, 'round:updated', round);
    res.status(201).json(round);
  }));

r.get('/rounds/current', requireRole('guard'), ah(async (req, res) => {
  const guardId = await guardOf(req);
  const [open] = await query("SELECT id FROM rounds WHERE guard_id=? AND status='in_progress'", [guardId]);
  res.json(open ? await roundDetail(req.tenantId, open.id) : null);
}));

r.post('/rounds/:id/scan', requireRole('guard'),
  validate(z.object({ tag_code: z.string(), method: z.enum(['nfc', 'qr']), lat: z.number().optional(), lng: z.number().optional() })),
  ah(async (req, res) => {
    const guardId = await guardOf(req);
    const [round] = await query("SELECT * FROM rounds WHERE id=? AND tenant_id=? AND guard_id=? AND status='in_progress'",
      [req.params.id, req.tenantId, guardId]);
    if (!round) { throw new HttpError(404, 'Ronda no activa'); }
    const [cp] = await query('SELECT id FROM checkpoints WHERE tenant_id=? AND tag_code=?', [req.tenantId, req.body.tag_code]);
    if (!cp) { throw new HttpError(404, 'Tag desconocido'); }
    const x = await query('UPDATE round_points SET scanned_at=?, method=?, lat=?, lng=? WHERE round_id=? AND checkpoint_id=? AND scanned_at IS NULL',
      [nowSql(), req.body.method, req.body.lat ?? null, req.body.lng ?? null, round.id, cp.id]);
    if (!x.affectedRows) { throw new HttpError(409, 'Punto ya marcado'); }
    const detail = await roundDetail(req.tenantId, round.id);
    emitToRoles(req.tenantId, SUP, 'round:updated', detail);
    res.json(detail);
  }));

r.post('/rounds/:id/finish', requireRole('guard'), ah(async (req, res) => {
  const guardId = await guardOf(req);
  const d = await roundDetail(req.tenantId, req.params.id);
  if (!d || d.guard_id !== guardId || d.status !== 'in_progress') { throw new HttpError(404, 'Ronda no activa'); }
  const missing = d.points.filter((p) => !p.scanned_at);
  const status = missing.length ? 'incomplete' : 'completed';
  await query('UPDATE rounds SET status=?, finished_at=? WHERE id=?', [status, nowSql(), d.id]);
  const detail = await roundDetail(req.tenantId, d.id);
  emitToRoles(req.tenantId, SUP, 'round:updated', detail);
  if (missing.length) { await raiseAlert(req.tenantId, detail, `Ronda finalizada con ${missing.length} punto(s) omitido(s): ${missing.map((m) => m.name).join(', ')}`); }
  await audit(req, 'round', d.id, status, { missing: missing.map((m) => m.name) });
  res.json(detail);
}));

// --- Supervisor: tablero ---
r.get('/rounds', requireRole(...SUP), ah(async (req, res) => {
  const rows = await query("SELECT id FROM rounds WHERE tenant_id=? AND started_at >= NOW() - INTERVAL 24 HOUR ORDER BY started_at DESC",
    [req.tenantId]);
  res.json(await Promise.all(rows.map((x) => roundDetail(req.tenantId, x.id))));
}));

async function raiseAlert(tenantId, round, message) {
  const alert = { round_id: round.id, guard_name: round.guard_name, message, at: new Date().toISOString() };
  emitToRoles(tenantId, SUP, 'round:alert', alert);
  publish('round.alert', { tenantId, round, message });
}

/** Job periódico: rondas que superaron el tiempo esperado → incompletas + alerta. */
export async function checkOverdueRounds() {
  const overdue = await query(
    `SELECT id, tenant_id FROM rounds WHERE status='in_progress' AND alerted=0
     AND started_at + INTERVAL expected_minutes MINUTE < ?`, [nowSql()]);
  for (const o of overdue) {
    await query("UPDATE rounds SET status='incomplete', alerted=1, finished_at=? WHERE id=?", [nowSql(), o.id]);
    const d = await roundDetail(o.tenant_id, o.id);
    const missing = d.points.filter((p) => !p.scanned_at).map((p) => p.name);
    await raiseAlert(o.tenant_id, d, `Ronda vencida sin completar. Faltan: ${missing.join(', ') || '—'}`);
  }
}

export default r;
