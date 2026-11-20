import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../lib/db.js';
import { ah, audit, validate, HttpError, nowSql } from '../lib/helpers.js';
import { requireRole } from '../middleware/auth.js';
import { emitToRoles } from '../lib/realtime.js';
import { publish } from '../notifications/events.js';
import { GEO, SCAN_STATUS, SUSPICIOUS, evaluateScan, zGeoReport, zLat, zLng } from '../lib/geo.js';
import { describeAgent } from '../notifications/subscriptions.js';
import { log } from '../lib/log.js';

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
    `SELECT rp.*, c.name, c.lat AS cp_lat, c.lng AS cp_lng, c.radius_m FROM round_points rp JOIN checkpoints c ON c.id=rp.checkpoint_id
     WHERE rp.round_id=? ORDER BY rp.sort_order`, [roundId]);
  round.geo = { max_accuracy_m: GEO.maxAccuracyM };
  return round;
}

// Ubicación de un punto: las dos coordenadas o ninguna (sin ubicación el punto no se puede marcar)
export const zCheckpoint = z.object({
  name: z.string().trim().min(1).max(80),
  tag_code: z.string().trim().min(4, 'Mínimo 4 caracteres').max(64),
  sort_order: z.number().int().default(0),
  lat: zLat.nullable().default(null),
  lng: zLng.nullable().default(null),
  radius_m: z.number().int().min(5, 'Mínimo 5 m').max(1000, 'Máximo 1000 m').default(GEO.defaultRadiusM),
});
const bothOrNone = (b) => (b.lat === undefined && b.lng === undefined) || ((b.lat == null) === (b.lng == null));

// --- Puntos de control (supervisor) ---
r.get('/checkpoints', ah(async (req, res) => {
  res.json(await query('SELECT * FROM checkpoints WHERE tenant_id=? AND active=1 ORDER BY sort_order', [req.tenantId]));
}));

r.post('/checkpoints', requireRole(...SUP),
  validate(zCheckpoint.refine(bothOrNone, { message: 'Cargue latitud y longitud juntas', path: ['lat'] })),
  ah(async (req, res) => {
    const b = req.body;
    const x = await query('INSERT INTO checkpoints (tenant_id,name,tag_code,sort_order,lat,lng,radius_m) VALUES (?,?,?,?,?,?,?)',
      [req.tenantId, b.name, b.tag_code, b.sort_order, b.lat, b.lng, b.radius_m]);
    await audit(req, 'checkpoint', x.insertId, 'create', { name: b.name, lat: b.lat, lng: b.lng, radius_m: b.radius_m });
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

// Marca de un punto. Sin ubicación válida, imprecisa o fuera del radio NO se registra:
// el intento queda en round_scans (y en audit_log si es sospechoso) y se responde 422 con el motivo.
// El cliente solo informa lo que midió: distancia, precisión y estado se deciden acá.
r.post('/rounds/:id/scan', requireRole('guard'),
  validate(z.object({ tag_code: z.string().trim().min(1).max(64), method: z.enum(['nfc', 'qr']) }).merge(zGeoReport)),
  ah(async (req, res) => {
    const guardId = await guardOf(req);
    const [round] = await query("SELECT * FROM rounds WHERE id=? AND tenant_id=? AND guard_id=? AND status='in_progress'",
      [req.params.id, req.tenantId, guardId]);
    if (!round) { throw new HttpError(404, 'Ronda no activa'); }
    const [cp] = await query('SELECT id,name,lat,lng,radius_m FROM checkpoints WHERE tenant_id=? AND tag_code=? AND active=1',
      [req.tenantId, req.body.tag_code]);
    if (!cp) {
      await audit(req, 'round', round.id, 'scan_unknown_tag', { tag_code: req.body.tag_code.slice(0, 64) });
      throw new HttpError(404, 'Código desconocido: no corresponde a un punto de control');
    }
    const [point] = await query('SELECT id, scanned_at FROM round_points WHERE round_id=? AND checkpoint_id=?', [round.id, cp.id]);
    if (!point) { throw new HttpError(409, 'Este punto no forma parte de la ronda en curso'); }
    if (point.scanned_at) { throw new HttpError(409, `El punto "${cp.name}" ya fue marcado en esta ronda`); }

    const v = evaluateScan(cp, req.body);
    const p = req.body.position;
    const dist = v.distance == null ? null : Math.round(v.distance * 10) / 10;
    const ua = describeAgent(req.get('user-agent') || '');
    const at = nowSql();
    const scanId = await tx(async (c) => {
      const [x] = await c.execute(
        `INSERT INTO round_scans (tenant_id,round_id,checkpoint_id,user_id,scanned_at,method,status,lat,lng,accuracy_m,distance_m,
           cp_lat,cp_lng,cp_radius_m,geo_error,device,browser,ip) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [req.tenantId, round.id, cp.id, req.user.id, at, req.body.method, v.status, p?.lat ?? null, p?.lng ?? null,
          v.accuracy, dist, cp.lat, cp.lng, cp.radius_m, req.body.geo_error ?? null, ua.device, ua.browser, String(req.ip || '').slice(0, 45)]);
      if (v.status === 'valid') {
        // Condicional: si dos escaneos llegan a la vez, solo uno marca el punto
        const [u] = await c.execute(
          'UPDATE round_points SET scanned_at=?, method=?, lat=?, lng=?, accuracy_m=?, distance_m=?, scan_id=? WHERE id=? AND scanned_at IS NULL',
          [at, req.body.method, p.lat, p.lng, v.accuracy, dist, x.insertId, point.id]);
        if (!u.affectedRows) { throw new HttpError(409, `El punto "${cp.name}" ya fue marcado en esta ronda`); }
      }
      return x.insertId;
    });

    const info = { scan_id: scanId, round_id: round.id, checkpoint_id: cp.id, checkpoint: cp.name, status: v.status,
      distance_m: dist == null ? null : Math.round(dist), accuracy_m: v.accuracy, lat: p?.lat ?? null, lng: p?.lng ?? null };
    log[v.status === 'valid' ? 'info' : 'warn']('round.scan', { tenant: req.tenantId, user: req.user.id, ...info });
    if (v.status !== 'valid') {
      if (SUSPICIOUS.has(v.status)) { await audit(req, 'round_scan', scanId, v.status, info); }
      emitToRoles(req.tenantId, SUP, 'round:scan', { ...info, guard_id: guardId, at });
      throw new HttpError(422, v.message, { status: v.status, distance_m: info.distance_m, accuracy_m: v.accuracy, radius_m: cp.radius_m });
    }
    const detail = await roundDetail(req.tenantId, round.id);
    emitToRoles(req.tenantId, SUP, 'round:updated', detail);
    res.json({ ...detail, scan: { ...info, message: v.message } });
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

// Recorrido de una ronda: marcas + todos los intentos (válidos y rechazados) con la ubicación del punto, para el mapa
r.get('/rounds/:id/scans', requireRole(...SUP), ah(async (req, res) => {
  const round = await roundDetail(req.tenantId, req.params.id);
  if (!round) { throw new HttpError(404, 'Ronda no encontrada'); }
  round.scans = await query(
    `SELECT s.*, c.name FROM round_scans s JOIN checkpoints c ON c.id=s.checkpoint_id
     WHERE s.round_id=? ORDER BY s.scanned_at, s.id`, [round.id]);
  res.json(round);
}));

// Informe de intentos (por defecto, los no válidos) de los últimos días: base para detectar fraude
r.get('/round-scans', requireRole(...SUP), ah(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
  const status = String(req.query.status || 'invalid');
  if (status !== 'invalid' && status !== 'all' && !SCAN_STATUS.includes(status)) { throw new HttpError(400, 'Estado inválido'); }
  const cond = status === 'invalid' ? " AND s.status<>'valid'" : status === 'all' ? '' : ' AND s.status=?';
  const rows = await query(
    `SELECT s.*, c.name, u.full_name AS guard_name FROM round_scans s
     JOIN checkpoints c ON c.id=s.checkpoint_id JOIN users u ON u.id=s.user_id
     WHERE s.tenant_id=? AND s.scanned_at >= NOW() - INTERVAL ${days} DAY${cond}
     ORDER BY s.scanned_at DESC, s.id DESC LIMIT 200`, cond.includes('?') ? [req.tenantId, status] : [req.tenantId]);
  res.json(rows);
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
