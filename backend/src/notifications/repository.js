// NotificationRepository: todo el SQL de la tabla notifications (historial + cola de envío).
import crypto from 'node:crypto';
import { query } from '../lib/db.js';

// LIMIT/OFFSET van como enteros ya validados: pool.execute no acepta LIMIT ? en MySQL 8.0.22+
const int = (v, def, max) => Math.max(0, Math.min(Number.parseInt(v, 10) || def, max));

export const MAX_ATTEMPTS = 5;
// Espera antes de cada reintento: 30 s, 2 min, 10 min, 30 min
const BACKOFF_S = [30, 120, 600, 1800];

/**
 * Encola una notificación por usuario. Con dedupe_key, la misma notificación no se repite
 * (un doble clic, un reintento del controlador o el scheduler pasando dos veces no duplican avisos).
 * @returns {Promise<number[]>} ids creados (los duplicados se omiten)
 */
export async function enqueue(tenantId, userIds, n, dedupeKey = null) {
  const ids = [];
  for (const userId of userIds) {
    const r = await query(
      `INSERT IGNORE INTO notifications
        (tenant_id,user_id,type,category,source_module,priority,title,body,action_url,action_label,image_url,entity_type,entity_id,dedupe_key)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [tenantId, userId, n.type, n.category, n.sourceModule, n.priority, n.title, n.body, n.actionUrl, n.actionLabel,
        n.imageUrl ?? null, n.entityType, n.entityId ?? null, dedupeKey]);
    if (r.affectedRows) { ids.push(r.insertId); }
  }
  return ids;
}

/**
 * Reserva un lote para enviar. El UPDATE con lock_id es atómico: dos workers nunca toman la misma fila.
 * También recupera filas que quedaron "sending" por una caída del proceso.
 */
export async function claim(limit = 25) {
  await query("UPDATE notifications SET status='queued', lock_id=NULL WHERE status='sending' AND locked_at < NOW() - INTERVAL 5 MINUTE");
  const lock = crypto.randomBytes(8).toString('hex');
  const r = await query(
    `UPDATE notifications SET status='sending', lock_id=?, locked_at=NOW(), attempts=attempts+1
      WHERE status='queued' AND next_attempt_at <= NOW() ORDER BY priority='high' DESC, id LIMIT ${int(limit, 25, 100)}`, [lock]);
  if (!r.affectedRows) { return []; }
  return query('SELECT * FROM notifications WHERE lock_id=? ORDER BY id', [lock]);
}

/**
 * Resultado de un intento.
 * @param {any} n fila
 * @param {{ devices: number, delivered: number[], transientError?: string, error?: string }} r
 */
export async function complete(n, r) {
  const delivered = r.delivered.length;
  let status;
  let next = null;
  if (r.devices === 0) {
    status = 'no_devices';
  } else if (r.transientError && n.attempts < MAX_ATTEMPTS) {
    status = 'queued'; // se reintenta solo en los dispositivos que faltan (delivered_to)
    next = BACKOFF_S[Math.min(n.attempts - 1, BACKOFF_S.length - 1)];
  } else {
    status = delivered === 0 ? 'failed' : delivered < r.devices ? 'partial' : 'sent';
  }
  await query(
    `UPDATE notifications SET status=?, lock_id=NULL, locked_at=NULL, device_count=?, delivered_count=?, delivered_to=?,
       last_error=?, next_attempt_at=IF(? IS NULL, next_attempt_at, NOW() + INTERVAL ? SECOND),
       sent_at=IF(? > 0 AND sent_at IS NULL, NOW(), sent_at)
     WHERE id=?`,
    [status, r.devices, delivered, JSON.stringify(r.delivered), (r.transientError || r.error || null)?.slice(0, 500) ?? null,
      next, next ?? 0, delivered, n.id]);
  return status;
}

// ----- Lectura (bandeja del usuario) -----

export const listForUser = (tenantId, userId, { category, limit = 50, before } = {}) => {
  const params = [tenantId, userId];
  let where = 'tenant_id=? AND user_id=?';
  if (category) { where += ' AND category=?'; params.push(category); }
  if (before) { where += ' AND id < ?'; params.push(Number(before)); }
  return query(
    `SELECT id,type,category,priority,title,body,action_url,action_label,entity_type,entity_id,status,created_at,sent_at,read_at
       FROM notifications WHERE ${where} ORDER BY id DESC LIMIT ${int(limit, 50, 100)}`, params);
};

export async function unreadCount(tenantId, userId) {
  const [r] = await query('SELECT COUNT(*) n FROM notifications WHERE tenant_id=? AND user_id=? AND read_at IS NULL', [tenantId, userId]);
  return r.n;
}

/** Marca como leída (una o todas). Solo las del propio usuario. */
export async function markRead(tenantId, userId, id = null) {
  const r = await query(
    `UPDATE notifications SET read_at=NOW() WHERE tenant_id=? AND user_id=? AND read_at IS NULL${id ? ' AND id=?' : ''}`,
    id ? [tenantId, userId, id] : [tenantId, userId]);
  return r.affectedRows;
}

/** Lectura informada por el service worker (sin sesión: viene validada por firma). */
export async function markReadById(id) {
  return (await query('UPDATE notifications SET read_at=NOW() WHERE id=? AND read_at IS NULL', [id])).affectedRows;
}

// ----- Panel de administración -----

export async function stats(tenantId, days = 30) {
  const [totals] = await query(
    `SELECT COUNT(*) total,
            SUM(status IN ('sent','partial')) sent, SUM(status='queued' OR status='sending') pending,
            SUM(status='failed') failed, SUM(status='no_devices') no_devices, SUM(read_at IS NOT NULL) read_count,
            SUM(device_count) devices_targeted, SUM(delivered_count) devices_delivered
       FROM notifications WHERE tenant_id=? AND created_at >= NOW() - INTERVAL ? DAY`, [tenantId, days]);
  const byCategory = await query(
    `SELECT category, COUNT(*) total, SUM(status IN ('sent','partial')) sent, SUM(read_at IS NOT NULL) read_count
       FROM notifications WHERE tenant_id=? AND created_at >= NOW() - INTERVAL ? DAY GROUP BY category ORDER BY total DESC`, [tenantId, days]);
  const daily = await query(
    `SELECT DATE(created_at) day, COUNT(*) total, SUM(status IN ('sent','partial')) sent, SUM(status='failed') failed
       FROM notifications WHERE tenant_id=? AND created_at >= NOW() - INTERVAL 14 DAY GROUP BY DATE(created_at) ORDER BY day`, [tenantId]);
  const devices = await query(
    `SELECT COALESCE(platform,'other') platform, COUNT(*) n, COUNT(DISTINCT user_id) users,
            SUM(last_seen >= NOW() - INTERVAL 30 DAY) active
       FROM push_subscriptions WHERE tenant_id=? GROUP BY platform`, [tenantId]);
  const num = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null ? 0 : (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v)]));
  return { totals: num(totals), byCategory: byCategory.map(num), daily: daily.map(num), devices: devices.map(num), days };
}

export function history(tenantId, { status, category, userId, q, limit = 50, offset = 0 } = {}) {
  const params = [tenantId];
  let where = 'n.tenant_id=?';
  if (status === 'pending') { where += " AND n.status IN ('queued','sending')"; } else if (status === 'read') { where += ' AND n.read_at IS NOT NULL'; } else if (status) { where += ' AND n.status=?'; params.push(status); }
  if (category) { where += ' AND n.category=?'; params.push(category); }
  if (userId) { where += ' AND n.user_id=?'; params.push(Number(userId)); }
  if (q) { where += ' AND (n.title LIKE ? OR n.body LIKE ? OR u.full_name LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  return query(
    `SELECT n.id, n.user_id, u.full_name AS user_name, n.type, n.category, n.source_module, n.priority, n.title, n.body,
            n.status, n.attempts, n.device_count, n.delivered_count, n.last_error, n.created_at, n.sent_at, n.read_at
       FROM notifications n JOIN users u ON u.id=n.user_id
      WHERE ${where} ORDER BY n.id DESC LIMIT ${int(limit, 50, 200)} OFFSET ${int(offset, 0, 1e6)}`, params);
}

/** Retención: el historial se conserva un año. */
export const purgeOld = () => query('DELETE FROM notifications WHERE created_at < NOW() - INTERVAL 365 DAY');
