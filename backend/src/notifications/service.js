// NotificationService: punto de entrada para crear notificaciones.
// preferencias → plantilla → cola (persistente) → aviso en vivo por socket → envío en segundo plano.
import { query } from '../lib/db.js';
import { emitToUser } from '../lib/realtime.js';
import { render } from './templates.js';
import { allowed } from './preferences.js';
import { enqueue } from './repository.js';
import { kick } from './queue.js';

/**
 * Notifica a usuarios concretos.
 * @param {number} tenantId
 * @param {number[]} userIds
 * @param {string} type clave de TEMPLATES
 * @param {any} data datos para la plantilla
 * @param {{ entityId?: number|string, dedupe?: string, imageUrl?: string, exclude?: number|null, force?: boolean }} [opts]
 *   dedupe: clave única por usuario (evita duplicados). force: ignora preferencias (pruebas del propio usuario).
 * @returns {Promise<number>} notificaciones creadas
 */
export async function notify(tenantId, userIds, type, data = {}, opts = {}) {
  const n = { ...render(type, data), entityId: opts.entityId ?? null, imageUrl: opts.imageUrl ?? null };
  let ids = [...new Set(userIds.map(Number))].filter((id) => id && id !== Number(opts.exclude));
  if (!opts.force) { ids = await allowed(ids, n.category); }
  if (!ids.length) { return 0; }
  const dedupe = opts.dedupe ? `${type}:${opts.dedupe}`.slice(0, 120) : null;
  const created = await enqueue(tenantId, ids, n, dedupe);
  if (created.length) {
    // Bandeja en vivo para quien tiene la app abierta (contador de no leídas)
    ids.forEach((u) => emitToUser(u, 'notification:new', { type, title: n.title, category: n.category }));
    kick();
  }
  return created.length;
}

// ----- Resolución de destinatarios (usada por events.js y scheduler.js) -----

const ROLE_JOIN = 'JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id';
const list = (rows) => rows.map((x) => x.id);
const marks = (a) => a.map(() => '?').join(',');

/** Usuarios activos del complejo con alguno de los roles (todos si roles está vacío). */
export async function usersWithRoles(tenantId, roles = []) {
  return list(await query(
    `SELECT DISTINCT u.id FROM users u ${ROLE_JOIN} WHERE u.tenant_id=? AND u.active=1${roles.length ? ` AND r.name IN (${marks(roles)})` : ''}`,
    [tenantId, ...roles]));
}

/** Quienes viven en el lote (residentes, propietario y familia) por su lote principal. */
export async function lotResidents(tenantId, lotId) {
  return list(await query('SELECT id FROM users WHERE tenant_id=? AND lot_id=? AND active=1', [tenantId, lotId]));
}

/**
 * Responsables económicos del lote: propietarios (lote principal o user_lots) y su familia.
 * Misma regla que lib/ownership.js para el portal de expensas.
 */
export async function lotPayers(tenantId, lotId) {
  return list(await query(
    `SELECT DISTINCT u.id FROM users u ${ROLE_JOIN}
      WHERE u.tenant_id=? AND u.active=1 AND r.name IN ('owner','family')
        AND (u.lot_id=? OR EXISTS (SELECT 1 FROM user_lots ul WHERE ul.lot_id=? AND ul.user_id = IF(r.name='owner', u.id, u.parent_user_id)))`,
    [tenantId, lotId, lotId]));
}
