// EventNotificationManager: la lógica de negocio publica HECHOS y este módulo decide
// quién recibe qué (destinatarios, plantilla, prioridad, deep link). Los controladores no conocen
// plantillas, preferencias ni dispositivos.
//
//   import { publish } from '../notifications/events.js';
//   publish('visit.entered', { tenantId, visit, actorId });
//
// publish() no bloquea ni lanza: un error al notificar nunca rompe la operación de negocio.
import { EventEmitter } from 'node:events';
import { query } from '../lib/db.js';
import { lotPayers, lotResidents, notify, usersWithRoles } from './service.js';

const bus = new EventEmitter();
const STAFF = ['admin', 'supervisor', 'guard'];

/** @type {Record<string, (e: any) => Promise<void>>} */
const HANDLERS = {
  // ----- Accesos y visitas -----
  'visit.requested': async ({ tenantId, visit }) => {
    await notify(tenantId, await lotResidents(tenantId, visit.lot_id), 'access.guest_waiting', visit,
      { entityId: visit.id, dedupe: visit.id });
  },

  'visit.decided': async ({ tenantId, visit, actorId }) => {
    const residents = await lotResidents(tenantId, visit.lot_id);
    if (visit.status === 'authorized') {
      await notify(tenantId, residents, 'visits.approved', visit, { entityId: visit.id, dedupe: visit.id, exclude: actorId });
      return;
    }
    // Rechazo: la unidad y la administración (que lo ve como "lote X")
    await notify(tenantId, residents, 'access.rejected', visit, { entityId: visit.id, dedupe: visit.id, exclude: actorId });
    const [lot] = await query('SELECT code FROM lots WHERE id=?', [visit.lot_id]);
    const admins = (await usersWithRoles(tenantId, ['admin'])).filter((id) => !residents.includes(id));
    await notify(tenantId, admins, 'access.rejected', { ...visit, forStaff: true, lot_code: lot?.code }, { entityId: visit.id, dedupe: visit.id, exclude: actorId });
  },

  'visit.entered': async ({ tenantId, visit }) => {
    let residents = await lotResidents(tenantId, visit.lot_id);
    // Invitación QR: quien la creó recibe "invitación utilizada"; el resto de la unidad, el ingreso
    if (visit.auth_method === 'qr' && visit.created_by) {
      await notify(tenantId, [visit.created_by], 'visits.used', visit, { entityId: visit.id, dedupe: visit.id });
      residents = residents.filter((id) => id !== visit.created_by);
    }
    const type = visit.vehicle_plate ? 'access.vehicle_entered' : 'access.guest_entered';
    await notify(tenantId, residents, type, visit, { entityId: visit.id, dedupe: visit.id });
  },

  'visit.exited': async ({ tenantId, visit }) => {
    const type = visit.vehicle_plate ? 'access.vehicle_exited' : 'access.guest_exited';
    await notify(tenantId, await lotResidents(tenantId, visit.lot_id), type, visit, { entityId: visit.id, dedupe: visit.id });
  },

  // ----- Emergencias y seguridad -----
  'incident.created': async ({ tenantId, incident, actorId }) => {
    if (incident.type === 'medical') {
      await notify(tenantId, await usersWithRoles(tenantId, ['guard', 'supervisor']), 'emergency.medical', incident,
        { entityId: incident.id, dedupe: incident.id, exclude: actorId });
      return;
    }
    // Seguridad: personal siempre; residentes solo si activaron "Seguridad" (lo filtra preferences)
    await notify(tenantId, await usersWithRoles(tenantId), 'security.alert', incident,
      { entityId: incident.id, dedupe: incident.id, exclude: actorId });
  },

  'round.alert': async ({ tenantId, round, message }) => {
    await notify(tenantId, await usersWithRoles(tenantId, ['supervisor', 'admin']), 'rounds.alert', { message },
      { entityId: round.id, dedupe: `${round.id}:${message}` });
  },

  // ----- Expensas -----
  'expenses.published': async ({ tenantId, runId, lotIds }) => {
    const users = new Set();
    for (const lot of lotIds) { (await lotPayers(tenantId, lot)).forEach((u) => users.add(u)); }
    await notify(tenantId, [...users], 'expenses.published', {}, { entityId: runId, dedupe: runId });
  },

  // ----- Reservas -----
  'reservation.confirmed': async ({ tenantId, reservation, actorId }) => {
    const [s] = await query('SELECT name FROM spaces WHERE id=?', [reservation.space_id]);
    await notify(tenantId, [reservation.user_id], 'reservations.confirmed', { space: s?.name },
      { entityId: reservation.id, dedupe: reservation.id, exclude: actorId });
  },
  'reservation.cancelled': async ({ tenantId, reservation, actorId }) => {
    const [s] = await query('SELECT name FROM spaces WHERE id=?', [reservation.space_id]);
    await notify(tenantId, [reservation.user_id], 'reservations.cancelled', { space: s?.name },
      { entityId: reservation.id, dedupe: reservation.id, exclude: actorId });
  },

  // ----- Comunicaciones -----
  'announcement.published': async ({ tenantId, announcement: a }) => {
    const users = a.audience === 'user' ? [a.target_user_id]
      : await usersWithRoles(tenantId, { all: [], owners: ['owner', 'family'], residents: ['owner', 'family', 'resident'], staff: STAFF }[a.audience]);
    await notify(tenantId, users, a.kind === 'message' ? 'announcements.message' : 'announcements.new', a,
      { entityId: a.id, dedupe: a.id, exclude: a.created_by });
  },
};

for (const [name, handler] of Object.entries(HANDLERS)) {
  bus.on(name, (e) => {
    handler(e).catch((err) => console.error(`[notifications] evento ${name}:`, err.message));
  });
}

export const EVENTS = Object.keys(HANDLERS);

/**
 * Publica un evento de negocio. No espera ni falla.
 * @param {string} name uno de EVENTS
 * @param {{ tenantId: number, actorId?: number } & Record<string, any>} payload
 */
export function publish(name, payload) {
  if (!HANDLERS[name]) { console.error(`[notifications] evento desconocido: ${name}`); return; }
  setImmediate(() => bus.emit(name, payload));
}

/** Para pruebas: ejecuta el manejador y espera a que termine. */
export const handle = (name, payload) => HANDLERS[name](payload);
