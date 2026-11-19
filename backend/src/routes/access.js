// Control de accesos: invitaciones QR de los propietarios, ingresos con DNI, egresos y rechazos de la guardia.
//
// Una fila de `visits` es a la vez la invitación y el movimiento:
//   invitación QR  → status 'authorized' + qr_token  (PENDIENTE de ingreso)
//   ingreso        → status 'inside'  + entry_at + entry_guard_id + entry_method (UTILIZADA)
//   egreso         → status 'exited'  + exit_at
//   rechazo        → status 'rejected' + rejected_at/by + reject_reason
//   cancelación    → status 'cancelled' (el propietario la anula antes de usarla)
//   vencida        → status 'expired' (se marca al escanearla fuera de término)
import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { query } from '../lib/db.js';
import { ah, audit, validate, HttpError, nowSql, toSql, parseSql } from '../lib/helpers.js';
import { requireRole, hasRole } from '../middleware/auth.js';
import { emitToRoles, emitToUser, lotUserIds } from '../lib/realtime.js';
import { familySql, searchLots } from '../lib/lotDirectory.js';
import { publish } from '../notifications/events.js';

const r = Router();
const RESIDENT = ['owner', 'family', 'resident'];
const GUARD = ['guard', 'supervisor', 'admin'];
const TYPE = z.enum(['visit', 'delivery', 'service', 'worker']);
const TOKEN_RE = /^[a-f0-9]{32}$/;

/** DNI argentino: se aceptan puntos y espacios, se guardan solo los dígitos. */
const zDni = z.string().transform((s) => s.replace(/\D/g, '')).pipe(z.string().regex(/^\d{6,9}$/, 'DNI inválido: debe tener entre 6 y 9 dígitos'));
const zName = z.string().trim().min(2, 'Nombre demasiado corto').max(120);
const zPlate = z.string().trim().toUpperCase().max(15).optional();
const zNotes = z.string().trim().max(255).optional();

/** "2026-11-19 14:05:00" → "19/11/2026 14:05" (sin conversiones de zona horaria). */
export const fmtSql = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : '';
};

const VISIT_SELECT = `SELECT v.*, l.code AS lot_code FROM visits v JOIN lots l ON l.id=v.lot_id`;
const getVisit = async (req, id) => {
  const [v] = await query(`${VISIT_SELECT} WHERE v.id=? AND v.tenant_id=?`, [id, req.tenantId]);
  if (!v) { throw new HttpError(404, 'Visita no encontrada'); }
  return v;
};

/** Avisa en vivo a la unidad y a la guardia. */
async function broadcast(req, visit) {
  (await lotUserIds(req.tenantId, visit.lot_id)).forEach((u) => emitToUser(u, 'visit:updated', visit));
  emitToRoles(req.tenantId, GUARD, 'visit:updated', visit);
}

/**
 * Estado de una invitación QR para la guardia (única regla de validación: la usan el escaneo y la confirmación).
 * @returns {{ state: 'pending'|'used'|'cancelled'|'expired'|'not_yet'|'rejected', message: string, canEnter: boolean }}
 */
export function invitationState(v, now = new Date()) {
  if (v.status === 'cancelled') { return { state: 'cancelled', message: 'Esta invitación fue cancelada por el propietario.', canEnter: false }; }
  if (v.status === 'rejected') { return { state: 'rejected', message: `El ingreso con esta invitación fue rechazado${v.rejected_at ? ` el ${fmtSql(v.rejected_at)}` : ''}.`, canEnter: false }; }
  if (v.entry_at || v.status === 'inside' || v.status === 'exited') {
    return { state: 'used', message: `Esta invitación ya fue utilizada el ${fmtSql(v.entry_at)}`, canEnter: false };
  }
  if (v.status === 'expired' || (v.valid_until && parseSql(v.valid_until) < now)) {
    return { state: 'expired', message: `Esta invitación venció el ${fmtSql(v.valid_until)}.`, canEnter: false };
  }
  if (v.valid_from && parseSql(v.valid_from) > now) {
    return { state: 'not_yet', message: `La invitación es válida desde el ${fmtSql(v.valid_from)}.`, canEnter: false };
  }
  if (v.status === 'authorized') { return { state: 'pending', message: 'Pendiente de ingreso', canEnter: true }; }
  return { state: 'rejected', message: 'La invitación no está habilitada.', canEnter: false };
}

// ---------- Listados ----------

const MOVEMENTS = { all: ['inside', 'exited', 'rejected'], inside: ['inside'], exited: ['exited'], rejected: ['rejected'] };

// Residentes: las visitas de su lote. Guardia: ?view=active (en curso) o ?movement=all|inside|exited|rejected (historial paginado)
r.get('/visits', ah(async (req, res) => {
  const params = [req.tenantId];
  let where = 'v.tenant_id=?';
  if (!hasRole(req, ...GUARD)) {
    where += ' AND v.lot_id=?';
    params.push(req.user.lot_id);
  } else if (req.query.movement) {
    const statuses = MOVEMENTS[req.query.movement];
    if (!statuses) { throw new HttpError(400, 'Filtro de movimientos inválido'); }
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 5, 1), 50);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const rows = await query(
      `SELECT v.id, v.visitor_name, v.visitor_dni, v.vehicle_plate, v.type, v.status, v.auth_method, v.entry_method, v.lot_id,
              v.entry_at, v.exit_at, v.rejected_at, v.reject_reason, v.last_movement_at, l.code AS lot_code, ${familySql('l')} AS family,
              ge.full_name AS guard_name
         FROM visits v JOIN lots l ON l.id=v.lot_id
         LEFT JOIN users ge ON ge.id = CASE v.status WHEN 'exited' THEN v.exit_guard_id WHEN 'rejected' THEN v.rejected_by ELSE v.entry_guard_id END
        WHERE v.tenant_id=? AND v.status IN (${statuses.map(() => '?').join(',')}) AND v.last_movement_at IS NOT NULL
        ORDER BY v.last_movement_at DESC, v.id DESC LIMIT ${limit + 1} OFFSET ${offset}`,
      [req.tenantId, ...statuses]);
    return res.json({ items: rows.slice(0, limit), hasMore: rows.length > limit });
  } else if (req.query.view === 'active') {
    // En curso: esperan respuesta del propietario, autorizados sin invitación que todavía no entraron, o adentro.
    // Las invitaciones QR no se listan acá (pueden ser cientos): se validan al escanearlas.
    where += " AND (v.status IN ('pending','inside') OR (v.status='authorized' AND v.auth_method<>'qr'))";
  }
  if (req.query.status) { where += ' AND v.status=?'; params.push(String(req.query.status)); }
  res.json(await query(`${VISIT_SELECT} WHERE ${where} ORDER BY v.created_at DESC LIMIT 200`, params));
}));

// Buscador de lote destino (número, titular o grupo familiar), paginado
r.get('/lots/search', requireRole(...GUARD), ah(async (req, res) => {
  res.json(await searchLots(req.tenantId, String(req.query.q || ''), req.query.page));
}));

// ---------- Invitaciones del propietario ----------

r.post('/visits/qr', requireRole(...RESIDENT),
  validate(z.object({
    visitor_name: zName, visitor_dni: zDni, vehicle_plate: zPlate, type: TYPE.default('visit'),
    valid_from: z.string(), valid_until: z.string(), notes: zNotes,
  })),
  ah(async (req, res) => {
    const b = req.body;
    if (!req.user.lot_id) { throw new HttpError(400, 'Tu usuario no tiene un lote asignado'); }
    const from = parseSql(b.valid_from), until = parseSql(b.valid_until);
    if (isNaN(from) || isNaN(until) || until <= from) { throw new HttpError(400, 'Rango de validez inválido'); }
    if (until < new Date()) { throw new HttpError(400, 'La fecha de la visita ya pasó'); }
    // El QR solo lleva este identificador aleatorio de 128 bits: ningún dato personal viaja en la imagen
    const token = crypto.randomBytes(16).toString('hex');
    const x = await query(
      `INSERT INTO visits (tenant_id,lot_id,visitor_name,visitor_dni,vehicle_plate,type,status,auth_method,qr_token,
        valid_from,valid_until,created_by,authorized_by,authorized_at,notes) VALUES (?,?,?,?,?,?,'authorized','qr',?,?,?,?,?,?,?)`,
      [req.tenantId, req.user.lot_id, b.visitor_name, b.visitor_dni, b.vehicle_plate || null, b.type, token,
        toSql(from), toSql(until), req.user.id, req.user.id, nowSql(), b.notes || null]);
    await audit(req, 'visit', x.insertId, 'qr_created', { ...b, visitor_dni: undefined });
    res.status(201).json({ id: x.insertId, qr_token: token });
  }));

// El propietario anula una invitación que todavía no se usó
r.post('/visits/:id/cancel', requireRole(...RESIDENT), ah(async (req, res) => {
  const v = await getVisit(req, req.params.id);
  if (v.lot_id !== req.user.lot_id) { throw new HttpError(403, 'No es de su lote'); }
  const x = await query(
    "UPDATE visits SET status='cancelled', cancelled_at=? WHERE id=? AND status='authorized' AND auth_method='qr' AND entry_at IS NULL",
    [nowSql(), v.id]);
  if (!x.affectedRows) { throw new HttpError(409, invitationState(v).message); }
  const updated = await getVisit(req, v.id);
  await broadcast(req, updated);
  await audit(req, 'visit', v.id, 'cancelled');
  res.json(updated);
}));

// ---------- Guardia: escaneo y validación de invitaciones ----------

r.get('/visits/invitation/:token', requireRole(...GUARD), ah(async (req, res) => {
  const token = String(req.params.token).trim().toLowerCase();
  if (!TOKEN_RE.test(token)) {
    await audit(req, 'visit', null, 'qr_invalid', { reason: 'formato', length: token.length });
    throw new HttpError(400, 'QR inválido o manipulado: no es una invitación del sistema.');
  }
  const [v] = await query(
    `SELECT v.*, l.code AS lot_code, ${familySql('l')} AS family, inv.full_name AS invited_by
       FROM visits v JOIN lots l ON l.id=v.lot_id LEFT JOIN users inv ON inv.id=v.created_by
      WHERE v.qr_token=? AND v.tenant_id=?`, [token, req.tenantId]);
  if (!v) {
    // Inexistente o de otro complejo: misma respuesta (no revela si existe en otro lado)
    await audit(req, 'visit', null, 'qr_not_found', { token_prefix: token.slice(0, 6) });
    throw new HttpError(404, 'Invitación inexistente.');
  }
  const st = invitationState(v);
  // Vencida sin usar: queda registrada como tal (historial y reportes)
  if (st.state === 'expired' && v.status === 'authorized') { await query("UPDATE visits SET status='expired' WHERE id=? AND status='authorized'", [v.id]); }
  await audit(req, 'visit', v.id, 'qr_scanned', { state: st.state });
  res.json({
    invitation: {
      id: v.id, visitor_name: v.visitor_name, visitor_dni: v.visitor_dni, vehicle_plate: v.vehicle_plate, type: v.type,
      notes: v.notes, lot_id: v.lot_id, lot_code: v.lot_code, family: v.family, invited_by: v.invited_by,
      valid_from: v.valid_from, valid_until: v.valid_until, entry_at: v.entry_at, created_at: v.created_at,
      status: st.state === 'expired' ? 'expired' : v.status,
    },
    state: st.state, message: st.message, can_enter: st.canEnter,
  });
}));

// ---------- Guardia: ingresos ----------

/**
 * Ingreso de una visita autorizada (invitación QR o autorización del propietario).
 * El UPDATE condicionado es atómico: dos guardias (o un doble toque) no pueden registrar dos ingresos.
 */
r.post('/visits/:id/entry', requireRole(...GUARD), ah(async (req, res) => {
  const v = await getVisit(req, req.params.id);
  const qr = v.auth_method === 'qr';
  if (qr) {
    const st = invitationState(v);
    if (!st.canEnter) {
      await audit(req, 'visit', v.id, 'entry_denied', { state: st.state });
      throw new HttpError(409, st.message);
    }
  } else if (v.status !== 'authorized') {
    throw new HttpError(409, v.entry_at ? `Esta visita ya ingresó el ${fmtSql(v.entry_at)}` : 'La visita no está autorizada');
  }
  const now = nowSql();
  const x = await query(
    `UPDATE visits SET status='inside', entry_at=?, entry_guard_id=?, entry_method=?, last_movement_at=?
      WHERE id=? AND status='authorized' AND entry_at IS NULL${qr ? ' AND valid_from <= ? AND valid_until >= ?' : ''}`,
    [now, req.user.id, qr ? 'invitation_qr' : 'dni_manual', now, v.id, ...(qr ? [now, now] : [])]);
  if (!x.affectedRows) {
    const again = await getVisit(req, v.id); // lo registró otro guardia en el mismo instante
    await audit(req, 'visit', v.id, 'entry_denied', { state: 'race' });
    throw new HttpError(409, invitationState(again).message);
  }
  const updated = await getVisit(req, v.id);
  await broadcast(req, updated);
  publish('visit.entered', { tenantId: req.tenantId, visit: updated, actorId: req.user.id });
  await audit(req, 'visit', v.id, 'entry', { method: updated.entry_method });
  res.json(updated);
}));

const walkIn = z.object({
  lot_id: z.number().int().positive(), visitor_name: zName, visitor_dni: zDni, vehicle_plate: zPlate, type: TYPE.default('visit'), notes: zNotes,
});
async function assertLot(req, lotId) {
  const [lot] = await query('SELECT id FROM lots WHERE id=? AND tenant_id=?', [lotId, req.tenantId]);
  if (!lot) { throw new HttpError(400, 'Lote inexistente'); }
}

// Ingreso directo con DNI escaneado (sin invitación): la guardia autoriza y registra el ingreso en un paso
r.post('/visits/walk-in', requireRole(...GUARD), validate(walkIn), ah(async (req, res) => {
  const b = req.body;
  await assertLot(req, b.lot_id);
  const now = nowSql();
  const x = await query(
    `INSERT INTO visits (tenant_id,lot_id,visitor_name,visitor_dni,vehicle_plate,type,status,auth_method,entry_method,
       created_by,authorized_by,authorized_at,entry_at,entry_guard_id,last_movement_at,notes)
     VALUES (?,?,?,?,?,?,'inside','guard','dni_manual',?,?,?,?,?,?,?)`,
    [req.tenantId, b.lot_id, b.visitor_name, b.visitor_dni, b.vehicle_plate || null, b.type, req.user.id, req.user.id, now, now, req.user.id, now, b.notes || null]);
  const visit = await getVisit(req, x.insertId);
  await broadcast(req, visit);
  publish('visit.entered', { tenantId: req.tenantId, visit, actorId: req.user.id });
  await audit(req, 'visit', visit.id, 'entry', { method: 'dni_manual', lot_id: b.lot_id, type: b.type });
  res.status(201).json(visit);
}));

// Visitante sin invitación → pide aprobación en tiempo real al lote (flujo original, se mantiene)
r.post('/visits/request', requireRole(...GUARD), validate(walkIn), ah(async (req, res) => {
  const b = req.body;
  await assertLot(req, b.lot_id);
  const x = await query(
    `INSERT INTO visits (tenant_id,lot_id,visitor_name,visitor_dni,vehicle_plate,type,status,auth_method,created_by,notes)
     VALUES (?,?,?,?,?,?,'pending','realtime',?,?)`,
    [req.tenantId, b.lot_id, b.visitor_name, b.visitor_dni, b.vehicle_plate || null, b.type, req.user.id, b.notes || null]);
  const visit = await getVisit(req, x.insertId);
  (await lotUserIds(req.tenantId, b.lot_id)).forEach((u) => emitToUser(u, 'visit:request', visit));
  emitToRoles(req.tenantId, GUARD, 'visit:updated', visit);
  publish('visit.requested', { tenantId: req.tenantId, visit, actorId: req.user.id });
  await audit(req, 'visit', x.insertId, 'requested', { lot_id: b.lot_id, type: b.type });
  res.status(201).json(visit);
}));

// ---------- Guardia: rechazos ----------

const rejectSchema = z.union([
  z.object({ visit_id: z.number().int().positive(), reason: zNotes }),
  walkIn.extend({ reason: zNotes }),
]);

// Rechazo de una invitación/visita existente, o de un visitante sin invitación (queda registrado igual)
r.post('/visits/reject', requireRole(...GUARD), validate(rejectSchema), ah(async (req, res) => {
  const b = req.body;
  const now = nowSql();
  let id;
  if ('visit_id' in b) {
    const v = await getVisit(req, b.visit_id);
    const x = await query(
      `UPDATE visits SET status='rejected', rejected_at=?, rejected_by=?, reject_reason=?, last_movement_at=?
        WHERE id=? AND status IN ('pending','authorized','expired') AND entry_at IS NULL`,
      [now, req.user.id, b.reason || null, now, v.id]);
    if (!x.affectedRows) { throw new HttpError(409, v.auth_method === 'qr' ? invitationState(v).message : 'La visita ya fue resuelta'); }
    id = v.id;
  } else {
    await assertLot(req, b.lot_id);
    const x = await query(
      `INSERT INTO visits (tenant_id,lot_id,visitor_name,visitor_dni,vehicle_plate,type,status,auth_method,created_by,
         rejected_at,rejected_by,reject_reason,last_movement_at,notes) VALUES (?,?,?,?,?,?,'rejected','guard',?,?,?,?,?,?)`,
      [req.tenantId, b.lot_id, b.visitor_name, b.visitor_dni, b.vehicle_plate || null, b.type, req.user.id, now, req.user.id, b.reason || null, now, b.notes || null]);
    id = x.insertId;
  }
  const updated = await getVisit(req, id);
  await broadcast(req, updated);
  publish('visit.decided', { tenantId: req.tenantId, visit: updated, actorId: req.user.id }); // aviso a la unidad y a la administración
  await audit(req, 'visit', id, 'rejected', { reason: b.reason || null, by: 'guard' });
  res.json(updated);
}));

// ---------- Propietario: aprueba o rechaza una visita en guardia ----------

r.post('/visits/:id/decision', requireRole(...RESIDENT), validate(z.object({ approve: z.boolean() })), ah(async (req, res) => {
  const v = await getVisit(req, req.params.id);
  if (v.lot_id !== req.user.lot_id) { throw new HttpError(403, 'No es de su lote'); }
  const now = nowSql();
  const x = req.body.approve
    ? await query("UPDATE visits SET status='authorized', authorized_by=?, authorized_at=? WHERE id=? AND status='pending'", [req.user.id, now, v.id])
    : await query("UPDATE visits SET status='rejected', authorized_by=?, authorized_at=?, rejected_at=?, rejected_by=?, last_movement_at=? WHERE id=? AND status='pending'",
      [req.user.id, now, now, req.user.id, now, v.id]);
  if (!x.affectedRows) { throw new HttpError(409, 'La visita ya fue resuelta'); }
  const updated = await getVisit(req, v.id);
  emitToRoles(req.tenantId, GUARD, 'visit:updated', updated);
  publish('visit.decided', { tenantId: req.tenantId, visit: updated, actorId: req.user.id });
  await audit(req, 'visit', v.id, updated.status);
  res.json(updated);
}));

// ---------- Guardia: egresos ----------

r.post('/visits/:id/exit', requireRole(...GUARD), ah(async (req, res) => {
  const v = await getVisit(req, req.params.id);
  const now = nowSql();
  const x = await query("UPDATE visits SET status='exited', exit_at=?, exit_guard_id=?, last_movement_at=? WHERE id=? AND status='inside'", [now, req.user.id, now, v.id]);
  if (!x.affectedRows) { throw new HttpError(409, 'La visita no está adentro'); }
  const updated = await getVisit(req, v.id);
  await broadcast(req, updated);
  publish('visit.exited', { tenantId: req.tenantId, visit: updated, actorId: req.user.id });
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
