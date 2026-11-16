import { Router } from 'express';
import { z } from 'zod';
import { query } from '../lib/db.js';
import { ah, audit, validate, HttpError, nowSql } from '../lib/helpers.js';
import { requireRole, hasRole } from '../middleware/auth.js';
import { emitToRoles, emitToUser, pushToRoles } from '../lib/realtime.js';

const r = Router();
const RESPONDERS = ['guard', 'supervisor'];
const STAFF = ['guard', 'supervisor', 'admin'];
const rateMap = new Map();

const getIncident = async (req, id) => {
  const [i] = await query(
    `SELECT i.*, u.full_name AS reporter, u.phone AS reporter_phone, l.code AS lot_code FROM incidents i
     JOIN users u ON u.id=i.reported_by LEFT JOIN lots l ON l.id=i.lot_id WHERE i.id=? AND i.tenant_id=?`,
    [id, req.tenantId]);
  if (!i) { throw new HttpError(404, 'Incidente no encontrado'); }
  return i;
};

// Botón de emergencia
r.post('/incidents',
  validate(z.object({
    type: z.enum(['medical', 'security']), description: z.string().max(500).optional(),
    lat: z.number().optional(), lng: z.number().optional(),
  })),
  ah(async (req, res) => {
    // Anti-rebote: 1 alerta cada 30 s por usuario
    const last = rateMap.get(req.user.id) || 0;
    if (Date.now() - last < 30000) { throw new HttpError(429, 'Ya se envió una alerta, aguarde unos segundos'); }
    rateMap.set(req.user.id, Date.now());

    const b = req.body;
    const x = await query('INSERT INTO incidents (tenant_id,type,reported_by,lot_id,lat,lng,description) VALUES (?,?,?,?,?,?,?)',
      [req.tenantId, b.type, req.user.id, req.user.lot_id ?? null, b.lat ?? null, b.lng ?? null, b.description ?? null]);
    const inc = await getIncident(req, x.insertId);
    emitToRoles(req.tenantId, STAFF, 'incident:new', inc);
    const label = b.type === 'medical' ? '🚑 EMERGENCIA MÉDICA' : '🚨 EMERGENCIA DE SEGURIDAD';
    await pushToRoles(req.tenantId, RESPONDERS, {
      title: label, body: `Lote ${inc.lot_code || '-'} · ${inc.reporter}`, url: `/emergencias`, urgent: true, tag: `inc-${inc.id}`,
    });
    await audit(req, 'incident', inc.id, 'created', b);
    res.status(201).json(inc);
  }));

r.get('/incidents', ah(async (req, res) => {
  const params = [req.tenantId];
  let where = 'i.tenant_id=?';
  if (!hasRole(req, ...STAFF)) { where += ' AND i.reported_by=?'; params.push(req.user.id); }
  res.json(await query(
    `SELECT i.*, u.full_name AS reporter, l.code AS lot_code FROM incidents i JOIN users u ON u.id=i.reported_by
     LEFT JOIN lots l ON l.id=i.lot_id WHERE ${where} ORDER BY i.created_at DESC LIMIT 200`, params));
}));

r.post('/incidents/:id/ack', requireRole(...STAFF), ah(async (req, res) => {
  const i = await getIncident(req, req.params.id);
  if (i.status !== 'open') { throw new HttpError(409, 'Ya fue tomado'); }
  await query("UPDATE incidents SET status='acknowledged', acknowledged_by=?, acknowledged_at=? WHERE id=?", [req.user.id, nowSql(), i.id]);
  const upd = await getIncident(req, i.id);
  emitToRoles(req.tenantId, STAFF, 'incident:updated', upd);
  emitToUser(i.reported_by, 'incident:updated', upd);
  await audit(req, 'incident', i.id, 'acknowledged');
  res.json(upd);
}));

r.post('/incidents/:id/resolve', requireRole(...STAFF), validate(z.object({ resolution: z.string().min(3).max(500) })), ah(async (req, res) => {
  const i = await getIncident(req, req.params.id);
  if (i.status === 'resolved') { throw new HttpError(409, 'Ya resuelto'); }
  await query("UPDATE incidents SET status='resolved', resolved_by=?, resolved_at=?, resolution=? WHERE id=?",
    [req.user.id, nowSql(), req.body.resolution, i.id]);
  const upd = await getIncident(req, i.id);
  emitToRoles(req.tenantId, STAFF, 'incident:updated', upd);
  emitToUser(i.reported_by, 'incident:updated', upd);
  await audit(req, 'incident', i.id, 'resolved', req.body);
  res.json(upd);
}));

// Auditoría del incidente
r.get('/incidents/:id/audit', requireRole(...STAFF), ah(async (req, res) => {
  const i = await getIncident(req, req.params.id);
  res.json(await query(
    `SELECT a.id,a.action,a.data,a.ip,a.created_at,u.full_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
     WHERE a.tenant_id=? AND a.entity='incident' AND a.entity_id=? ORDER BY a.id`, [req.tenantId, i.id]));
}));

export default r;
