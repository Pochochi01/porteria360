// Directorio de lotes para la guardia: quién vive o es dueño de cada lote.
// Único lugar donde se arma la "familia" de un lote (buscador de destino, validación de invitaciones y movimientos).
import { query } from './db.js';

const RESIDENT_ROLES = "('owner','family','resident')";

/**
 * Subconsulta: nombres de los residentes activos del lote, propietarios primero.
 * Cuenta el lote principal (users.lot_id) y los lotes adicionales del propietario (user_lots).
 * @param {string} lot alias de la tabla lots en la consulta externa
 */
export const familySql = (lot) => `(
  SELECT GROUP_CONCAT(DISTINCT u.full_name ORDER BY (r.name='owner') DESC, u.full_name SEPARATOR ' · ')
    FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
   WHERE u.tenant_id=${lot}.tenant_id AND u.active=1 AND r.name IN ${RESIDENT_ROLES}
     AND (u.lot_id=${lot}.id OR EXISTS (SELECT 1 FROM user_lots ul WHERE ul.user_id=u.id AND ul.lot_id=${lot}.id)))`;

/** Titular: el primer propietario del lote (o el primer residente si no hay propietario cargado). */
const holderSql = (lot) => `(
  SELECT u.full_name FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
   WHERE u.tenant_id=${lot}.tenant_id AND u.active=1 AND r.name IN ${RESIDENT_ROLES}
     AND (u.lot_id=${lot}.id OR EXISTS (SELECT 1 FROM user_lots ul WHERE ul.user_id=u.id AND ul.lot_id=${lot}.id))
   ORDER BY (r.name='owner') DESC, u.id LIMIT 1)`;

export const PAGE_SIZE = 20;

/**
 * Busca lotes por número, titular o integrantes del grupo familiar.
 * "125" → lotes que empiezan con 125 (el exacto primero). "Pérez" / "Familia Pérez" → lotes donde vive un Pérez.
 * @returns {Promise<{ items: { id: number, code: string, address: string|null, holder: string|null, family: string|null }[], hasMore: boolean }>}
 */
export async function searchLots(tenantId, rawQ = '', page = 0) {
  const q = String(rawQ).trim().replace(/^familia\s+/i, '').slice(0, 60);
  const offset = Math.max(0, Number.parseInt(page, 10) || 0) * PAGE_SIZE;
  const params = [tenantId];
  let where = 'l.tenant_id=?';
  let order = 'LENGTH(l.code), l.code';
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    where += ` AND (l.code LIKE ? OR EXISTS (
      SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
       WHERE u.tenant_id=l.tenant_id AND u.active=1 AND r.name IN ${RESIDENT_ROLES} AND u.full_name LIKE ?
         AND (u.lot_id=l.id OR EXISTS (SELECT 1 FROM user_lots ul WHERE ul.user_id=u.id AND ul.lot_id=l.id))))`;
    params.push(`${q.replace(/[%_\\]/g, '\\$&')}%`, like);
    order = `(l.code = ${'?'}) DESC, ${order}`;
    params.push(q);
  }
  // Se pide uno de más para saber si hay otra página
  const rows = await query(
    `SELECT l.id, l.code, l.address, ${holderSql('l')} AS holder, ${familySql('l')} AS family
       FROM lots l WHERE ${where} ORDER BY ${order} LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`, params);
  return { items: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}
