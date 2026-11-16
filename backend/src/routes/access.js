import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { query } from '../lib/db.js';
import { ah, audit, validate, HttpError, nowSql, toSql, parseSql } from '../lib/helpers.js';
import { requireRole, hasRole } from '../middleware/auth.js';
import { emitToRoles, emitToUser, pushToUsers, lotUserIds } from '../lib/realtime.js';

const r = Router();
const RESIDENT = ['owner', 'family', 'resident'];
const GUARD = ['guard', 'supervisor', 'admin'];

const getVisit = async (req, id) => {
  const [v] = await query('SELECT * FROM visits WHERE id=? AND tenant_id=?', [id, req.tenantId]);
  if (!v) { throw new HttpError(404, 'Visita no encontrada'); }
  return v;
};

// Listado: guardias ven todo; residentes solo su lote
r.get('/visits', ah(async (req, res) => {
  const status = req.query.status;
  const params = [req.tenantId];
  let where = 'v.tenant_id=?';
  if (!hasRole(req, ...GUARD)) { where += ' AND v.lot_id=?'; params.push(req.user.lot_id); }
  if (status) { where += ' AND v.status=?'; params.push(status); }
  res.json(await query(
    `SELECT v.*, l.code AS lot_code FROM visits v JOIN lots l ON l.id=v.lot_id
     WHERE ${where} ORDER BY v.created_at DESC LIMIT 200`, params));
}));

// Residente pre-autoriza visita → genera QR
r.post('/visits/qr', requireRole(...RESIDENT),
  validate(z.object({
    visitor_name: z.string().min(2).max(120), visitor_dni: z.string().max(20).optional(),
    vehicle_plate: z.string().max(15).optional(), type: z.enum(['visit', 'delivery', 'service', 'worker']).default('visit'),
    valid_from: z.string(), valid_until: z.string(),
  })),
  ah(async (req, res) => {
    const b = req.body;
    const from = parseSql(b.valid_from), until = parseSql(b.valid_until);
    if (isNaN(from) || isNaN(until) || until <= from) { throw new HttpError(400, 'Rango de validez inválido'); }
    const token = crypto.randomBytes(16).toString('hex');
    const x = await query(
      `INSERT INTO visits (tenant_id,lot_id,visitor_name,visitor_dni,vehicle_plate,type,status,auth_method,qr_token,
        valid_from,valid_until,created_by,authorized_by,authorized_at) VALUES (?,?,?,?,?,?,'authorized','qr',?,?,?,?,?,?)`,
      [req.tenantId, req.user.lot_id, b.visitor_name, b.visitor_dni ?? null, b.vehicle_plate ?? null, b.type, token,
        toSql(from), toSql(until), req.user.id, req.user.id, nowSql()]);
    await audit(req, 'visit', x.insertId, 'qr_created', b);
    res.status(201).json({ id: x.insertId, qr_token: token });
  }));

// Guardia escanea QR
r.post('/visits/scan', requireRole(...GUARD), validate(z.object({ qr_token: z.string().length(32) })), ah(async (req, res) => {
  const [v] = await query(
    `SELECT v.*, l.code AS lot_code FROM visits v JOIN lots l ON l.id=v.lot_id WHERE v.qr_token=? AND v.tenant_id=?`,
    [req.body.qr_token, req.tenantId]);
  if (!v) { throw new HttpError(404, 'QR inválido'); }
  const now = new Date();
  const valid = v.status === 'authorized' && parseSql(v.valid_from) <= now && now <= parseSql(v.valid_until);
  await audit(req, 'visit', v.id, 'qr_scanned', { valid });
  res.json({ visit: v, valid });
}));

// Guardia registra llegada sin QR → pide aprobación en tiempo real al lote
r.post('/visits/request', requireRole(...GUARD),
  validate(z.object({
    lot_id: z.number().int(), visitor_name: z.string().min(2), visitor_dni: z.string().max(20),
    vehicle_plate: z.string().max(15).optional(), type: z.enum(['visit', 'delivery', 'service', 'worker']).default('visit'),
    notes: z.string().max(255).optional(),
  })),
  ah(async (req, res) => {
    const b = req.body;
    const [lot] = await query('SELECT id FROM lots WHERE id=? AND tenant_id=?', [b.lot_id, req.tenantId]);
    if (!lot) { throw new HttpError(400, 'Lote inexistente'); }
    const x = await query(
      `INSERT INTO visits (tenant_id,lot_id,visitor_name,visitor_dni,vehicle_plate,type,status,auth_method,created_by,notes)
       VALUES (?,?,?,?,?,?,'pending','realtime',?,?)`,
      [req.tenantId, b.lot_id, b.visitor_name, b.visitor_dni, b.vehicle_plate ?? null, b.type, req.user.id, b.notes ?? null]);
    const visit = await getVisit(req, x.insertId);
    const users = await lotUserIds(req.tenantId, b.lot_id);
    users.forEach((u) => emitToUser(u, 'visit:request', visit));
    await pushToUsers(req.tenantId, users, { title: 'Visita en guardia', body: `${b.visitor_name} solicita ingresar`, url: '/visitas', urgent: true });
    await audit(req, 'visit', x.insertId, 'requested', b);
    res.status(201).json(visit);
  }));

// Residente aprueba/rechaza
r.post('/visits/:id/decision', requireRole(...RESIDENT), validate(z.object({ approve: z.boolean() })), ah(async (req, res) => {
  const v = await getVisit(req, req.params.id);
  if (v.lot_id !== req.user.lot_id) { throw new HttpError(403, 'No es de su lote'); }
  if (v.status !== 'pending') { throw new HttpError(409, 'La visita ya fue resuelta'); }
  const status = req.body.approve ? 'authorized' : 'rejected';
  await query('UPDATE visits SET status=?, authorized_by=?, authorized_at=? WHERE id=?', [status, req.user.id, nowSql(), v.id]);
  const updated = await getVisit(req, v.id);
  emitToRoles(req.tenantId, GUARD, 'visit:updated', updated);
  await audit(req, 'visit', v.id, status);
  res.json(updated);
}));

// Guardia registra entrada / salida
r.post('/visits/:id/entry', requireRole(...GUARD), ah(async (req, res) => {
  const v = await getVisit(req, req.params.id);
  if (v.status !== 'authorized') { throw new HttpError(409, 'Visita no autorizada'); }
  await query("UPDATE visits SET status='inside', entry_at=?, entry_guard_id=? WHERE id=?", [nowSql(), req.user.id, v.id]);
  const updated = await getVisit(req, v.id);
  (await lotUserIds(req.tenantId, v.lot_id)).forEach((u) => emitToUser(u, 'visit:updated', updated));
  emitToRoles(req.tenantId, GUARD, 'visit:updated', updated);
  await audit(req, 'visit', v.id, 'entry');
  res.json(updated);
}));

r.post('/visits/:id/exit', requireRole(...GUARD), ah(async (req, res) => {
  const v = await getVisit(req, req.params.id);
  if (v.status !== 'inside') { throw new HttpError(409, 'La visita no está adentro'); }
  await query("UPDATE visits SET status='exited', exit_at=?, exit_guard_id=? WHERE id=?", [nowSql(), req.user.id, v.id]);
  const updated = await getVisit(req, v.id);
  emitToRoles(req.tenantId, GUARD, 'visit:updated', updated);
  await audit(req, 'visit', v.id, 'exit');
  res.json(updated);
}));

// Trazabilidad completa de una visita
r.get('/visits/:id/trace', ah(async (req, res) => {
  const v = await getVisit(req, req.params.id);
  if (!hasRole(req, ...GUARD) && v.lot_id !== req.user.lot_id) { throw new HttpError(403, 'Permiso denegado'); }
  const log = await query(
    `SELECT a.action,a.data,a.created_at,u.full_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
     WHERE a.tenant_id=? AND a.entity='visit' AND a.entity_id=? ORDER BY a.id`, [req.tenantId, v.id]);
  res.json({ visit: v, log });
}));

export default r;
