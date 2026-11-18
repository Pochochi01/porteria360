// Recordatorios programados: vencimiento de expensas, expensas vencidas, reservas próximas e invitaciones por vencer.
// Corre cada 5 minutos. Cada recordatorio sale UNA vez por tramo (dedupe), aunque el job pase muchas veces.
//
// Tramos: con anticipaciones [7, 3, 1] y 2 días restantes corresponde el tramo "3"; se envía una vez y el
// próximo aviso será el del tramo "1". Así nunca hay ráfagas ni repeticiones.
import { query } from '../lib/db.js';
import { toSql, parseSql } from '../lib/helpers.js';
import { getMany } from './preferences.js';
import { lotPayers, notify } from './service.js';
import { purgeOld } from './repository.js';

const INTERVAL_MS = 5 * 60_000;
const HOUR = 3600_000;

/** Menor anticipación configurada que ya se alcanzó (o null). */
export const bucketFor = (remaining, offsets) => [...offsets].sort((a, b) => a - b).find((o) => remaining <= o) ?? null;

/** Agrupa destinatarios por tramo según su preferencia y notifica cada grupo. */
async function byBucket(tenantId, users, prefKey, remaining, type, data, entityId, dedupeBase, { maxSpan = Infinity } = {}) {
  const prefs = await getMany(users);
  const groups = new Map();
  for (const u of users) {
    // Un tramo mayor que la vida total del elemento no tiene sentido (p. ej. "vence en 24 h" para una invitación de 12 h)
    const b = bucketFor(remaining, (prefs.get(u)?.reminders[prefKey] || []).filter((o) => o < maxSpan));
    if (b != null) { groups.set(b, [...(groups.get(b) || []), u]); }
  }
  let n = 0;
  for (const [b, ids] of groups) {
    n += await notify(tenantId, ids, type, { ...data, [prefKey.endsWith('days') ? 'days' : 'hours']: Math.max(0, Math.ceil(remaining)) },
      { entityId, dedupe: `${dedupeBase}:${b}` });
  }
  return n;
}

async function expenseReminders() {
  // Próximas a vencer (hasta 7 días: el máximo configurable)
  const soon = await query(
    `SELECT id, tenant_id, lot_id, period, DATEDIFF(due_date, CURDATE()) days FROM expense_settlements
      WHERE status='pending' AND due_date BETWEEN CURDATE() AND CURDATE() + INTERVAL 7 DAY`);
  for (const s of soon) {
    await byBucket(s.tenant_id, await lotPayers(s.tenant_id, s.lot_id), 'expense_due_days', Number(s.days),
      'expenses.due_soon', { period: s.period }, s.id, s.id);
  }
  // Vencidas: aviso único al día siguiente del vencimiento (no se reenvía el historial viejo)
  const overdue = await query(
    `SELECT id, tenant_id, lot_id, period FROM expense_settlements
      WHERE status='pending' AND due_date BETWEEN CURDATE() - INTERVAL 3 DAY AND CURDATE() - INTERVAL 1 DAY`);
  for (const s of overdue) {
    await notify(s.tenant_id, await lotPayers(s.tenant_id, s.lot_id), 'expenses.overdue', { period: s.period }, { entityId: s.id, dedupe: s.id });
  }
}

async function reservationReminders(now) {
  const rows = await query(
    `SELECT r.id, r.tenant_id, r.user_id, r.start_at, s.name space FROM reservations r JOIN spaces s ON s.id=r.space_id
      WHERE r.status='approved' AND r.start_at > ? AND r.start_at <= ?`, [toSql(now), toSql(new Date(now.getTime() + 24 * HOUR))]);
  for (const r of rows) {
    const hours = (parseSql(r.start_at) - now) / HOUR;
    await byBucket(r.tenant_id, [r.user_id], 'reservation_hours', hours, 'reservations.reminder', { space: r.space }, r.id, r.id);
  }
}

async function invitationReminders(now) {
  const rows = await query(
    `SELECT id, tenant_id, created_by, visitor_name, valid_until, created_at FROM visits
      WHERE status='authorized' AND auth_method='qr' AND entry_at IS NULL AND valid_until > ? AND valid_until <= ?`,
    [toSql(now), toSql(new Date(now.getTime() + 24 * HOUR))]);
  for (const v of rows) {
    const until = parseSql(v.valid_until);
    await byBucket(v.tenant_id, [v.created_by], 'invitation_hours', (until - now) / HOUR, 'visits.expiring', v, v.id, v.id,
      { maxSpan: (until - parseSql(v.created_at)) / HOUR });
  }
}

let lastPurge = 0;
export async function runReminders(now = new Date()) {
  for (const job of [expenseReminders, () => reservationReminders(now), () => invitationReminders(now)]) {
    try { await job(); } catch (e) { console.error('[notifications] recordatorios:', e.message); }
  }
  if (Date.now() - lastPurge > 24 * HOUR) {
    lastPurge = Date.now();
    await purgeOld().catch((e) => console.error('[notifications] purga:', e.message));
  }
}

let timer = null;
export function startScheduler() {
  if (timer) { return; }
  timer = setInterval(() => runReminders(), INTERVAL_MS);
  timer.unref?.();
  setTimeout(() => runReminders(), 15_000).unref?.(); // primera pasada poco después de arrancar
}
export const stopScheduler = () => { clearInterval(timer); timer = null; };
