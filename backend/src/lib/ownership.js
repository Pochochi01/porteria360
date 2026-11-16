// Qué lotes puede ver cada usuario en el módulo de expensas (único lugar donde se decide).
//  - owner: sus lotes (user_lots) + su lote principal (users.lot_id)
//  - family: los lotes del propietario que lo cargó (parent_user_id) + su lote principal
//  - resto (resident, guard, …): ninguno. Los inquilinos no ven datos económicos.
import { query } from './db.js';
import { HttpError } from './helpers.js';
import { hasRole } from '../middleware/auth.js';

/** @returns {Promise<number[]>} ids de lote */
export async function userLotIds(req) {
  const isOwner = hasRole(req, 'owner');
  if (!isOwner && !hasRole(req, 'family')) { return []; }
  const rows = await query(
    `SELECT DISTINCT ul.lot_id AS id FROM user_lots ul
       JOIN users u ON u.id = ? AND u.tenant_id = ?
      WHERE ul.tenant_id = u.tenant_id AND ul.user_id = ${isOwner ? 'u.id' : 'u.parent_user_id'}
     UNION
     SELECT lot_id AS id FROM users WHERE id = ? AND tenant_id = ? AND lot_id IS NOT NULL`,
    [req.user.id, req.tenantId, req.user.id, req.tenantId]);
  return rows.map((r) => r.id);
}

/** Lanza 403 si el lote no pertenece al usuario (los administradores ven todo). */
export async function assertLotAccess(req, lotId) {
  if (hasRole(req, 'admin')) { return; }
  if (!(await userLotIds(req)).includes(Number(lotId))) { throw new HttpError(403, 'Permiso denegado'); }
}

/** Fragmento SQL "col IN (…)" seguro para filtrar por lotes; si no hay lotes, no devuelve nada. */
export const inLots = (column, ids) => (ids.length ? { sql: `${column} IN (${ids.map(() => '?').join(',')})`, params: ids } : { sql: '1=0', params: [] });
