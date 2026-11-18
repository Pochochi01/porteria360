// NotificationPreferencesService: qué categorías recibe cada usuario y con cuánta anticipación los recordatorios.
// Sin fila guardada se usan los valores por defecto del rol, así no hace falta migrar usuarios existentes.
import { query } from '../lib/db.js';
import { CATEGORIES } from './templates.js';

const STAFF = ['admin', 'supervisor', 'guard'];

/** Anticipaciones permitidas (los valores que el usuario puede elegir). */
export const REMINDER_OPTIONS = {
  expense_due_days: [7, 3, 1],
  reservation_hours: [24, 2],
  invitation_hours: [24, 12, 1],
};

/** El personal de guardia no puede silenciar emergencias: es un aviso de seguridad, no informativo. */
export const lockedFor = (roles) => (roles.some((r) => STAFF.includes(r)) ? ['emergencies'] : []);

/** @param {string[]} roles */
export function defaultsFor(roles) {
  const staff = roles.some((r) => STAFF.includes(r));
  const categories = Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, true]));
  // Alertas de seguridad del barrio: el personal siempre; los residentes solo si las activan
  categories.security = staff;
  return {
    categories,
    reminders: { expense_due_days: [3, 1], reservation_hours: [24, 2], invitation_hours: [1] },
  };
}

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

/** Mezcla lo guardado con los valores por defecto (una categoría nueva arranca con su default). */
function merge(roles, row) {
  const def = defaultsFor(roles);
  const prefs = row
    ? { categories: { ...def.categories, ...parse(row.categories) }, reminders: { ...def.reminders, ...parse(row.reminders) } }
    : def;
  for (const k of lockedFor(roles)) { prefs.categories[k] = true; }
  return prefs;
}

async function rolesOf(userIds) {
  if (!userIds.length) { return new Map(); }
  const rows = await query(
    `SELECT ur.user_id, r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id IN (${userIds.map(() => '?').join(',')})`, userIds);
  const m = new Map(userIds.map((id) => [id, []]));
  rows.forEach((r) => m.get(r.user_id)?.push(r.name));
  return m;
}

/** Preferencias efectivas de varios usuarios en una sola consulta. @returns {Promise<Map<number, ReturnType<typeof merge>>>} */
export async function getMany(userIds) {
  const ids = [...new Set(userIds)];
  if (!ids.length) { return new Map(); }
  const [roles, rows] = await Promise.all([
    rolesOf(ids),
    query(`SELECT * FROM notification_preferences WHERE user_id IN (${ids.map(() => '?').join(',')})`, ids),
  ]);
  const byUser = new Map(rows.map((r) => [r.user_id, r]));
  return new Map(ids.map((id) => [id, merge(roles.get(id) || [], byUser.get(id))]));
}

/** @param {{ id: number, roles: string[] }} user */
export async function get(user) {
  const [row] = await query('SELECT * FROM notification_preferences WHERE user_id=?', [user.id]);
  return { ...merge(user.roles, row), locked: lockedFor(user.roles), options: REMINDER_OPTIONS, labels: CATEGORIES };
}

/**
 * Guarda solo claves y valores conocidos (lo demás se ignora).
 * @param {{ id: number, roles: string[] }} user
 * @param {number} tenantId
 * @param {{ categories?: Record<string, boolean>, reminders?: Record<string, number[]> }} input
 */
export async function update(user, tenantId, input) {
  const current = await get(user);
  const categories = { ...current.categories };
  for (const [k, v] of Object.entries(input.categories || {})) {
    if (k in CATEGORIES && typeof v === 'boolean' && !current.locked.includes(k)) { categories[k] = v; }
  }
  const reminders = { ...current.reminders };
  for (const [k, v] of Object.entries(input.reminders || {})) {
    if (k in REMINDER_OPTIONS && Array.isArray(v)) {
      reminders[k] = REMINDER_OPTIONS[k].filter((o) => v.includes(o)); // solo opciones válidas, ordenadas
    }
  }
  await query(
    `INSERT INTO notification_preferences (user_id, tenant_id, categories, reminders) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE categories=VALUES(categories), reminders=VALUES(reminders)`,
    [user.id, tenantId, JSON.stringify(categories), JSON.stringify(reminders)]);
  return get(user);
}

/** Filtra destinatarios según la categoría. @returns {Promise<number[]>} */
export async function allowed(userIds, category) {
  const prefs = await getMany(userIds);
  return [...prefs].filter(([, p]) => p.categories[category] !== false).map(([id]) => id);
}
