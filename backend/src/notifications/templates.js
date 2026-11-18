// NotificationTemplates: el texto, la categoría, la prioridad y el deep link de cada tipo de notificación.
// Único lugar donde se escriben títulos y mensajes. Para un tipo nuevo, agregar una entrada acá
// y su regla de destinatarios en events.js.

/** Categorías que el usuario puede activar o desactivar (ver preferences.js). */
export const CATEGORIES = {
  security: 'Seguridad',
  access: 'Accesos',
  visits: 'Visitas',
  reservations: 'Reservas',
  expenses: 'Expensas',
  announcements: 'Comunicados',
  emergencies: 'Emergencias',
  alerts: 'Alertas',
};

const plate = (d) => d.vehicle_plate || '';
const name = (d) => d.visitor_name || 'Su invitado';

/**
 * @typedef {object} Template
 * @property {keyof typeof CATEGORIES} category
 * @property {string} module   módulo de origen (auditoría y filtros del panel)
 * @property {'normal'|'high'} [priority]
 * @property {(d: any) => string} title
 * @property {(d: any) => string} body
 * @property {(d: any) => string} url   ruta de la PWA que abre al tocar la notificación
 * @property {string} [action]          texto del botón de acción
 * @property {string} [entity]          tipo de entidad relacionada
 */

/** @type {Record<string, Template>} */
export const TEMPLATES = {
  // ----- Seguridad y accesos -----
  'access.guest_entered': {
    category: 'access', module: 'access', entity: 'visit', action: 'Ver acceso',
    title: () => '✅ Invitado ingresó', body: (d) => `${name(d)} ingresó al complejo.`, url: () => '/visitas',
  },
  'access.guest_exited': {
    category: 'access', module: 'access', entity: 'visit', action: 'Ver detalle',
    title: () => '🚪 Invitado egresó', body: (d) => `${name(d)} ha salido del complejo.`, url: () => '/visitas',
  },
  'access.vehicle_entered': {
    category: 'access', module: 'access', entity: 'visit', action: 'Ver acceso',
    title: () => '🚗 Vehículo ingresó', body: (d) => `El vehículo autorizado ${plate(d)} ingresó al complejo.`, url: () => '/visitas',
  },
  'access.vehicle_exited': {
    category: 'access', module: 'access', entity: 'visit', action: 'Ver detalle',
    title: () => '🚙 Vehículo egresó', body: (d) => `El vehículo autorizado ${plate(d)} ha salido del complejo.`, url: () => '/visitas',
  },
  'access.rejected': {
    category: 'access', module: 'access', entity: 'visit', priority: 'high', action: 'Ver detalle',
    title: () => '⚠ Acceso rechazado', body: (d) => `Se rechazó un intento de acceso relacionado con ${d.forStaff ? `el lote ${d.lot_code}` : 'su unidad'}.`,
    url: (d) => (d.forStaff ? '/guardia' : '/visitas'),
  },
  'access.guest_waiting': {
    category: 'visits', module: 'access', entity: 'visit', priority: 'high', action: 'Responder',
    title: () => '🔔 Visita en guardia', body: (d) => `${name(d)} solicita ingresar.`, url: () => '/visitas',
  },
  'security.alert': {
    category: 'security', module: 'emergencies', entity: 'incident', priority: 'high', action: 'Ver alerta',
    title: () => '🚨 Alerta de seguridad', body: (d) => `Se registró una nueva alerta de seguridad${d.lot_code ? ` (lote ${d.lot_code})` : ''}.`,
    url: () => '/emergencias',
  },
  'emergency.medical': {
    category: 'emergencies', module: 'emergencies', entity: 'incident', priority: 'high', action: 'Atender',
    title: () => '🚑 Emergencia médica', body: (d) => `Lote ${d.lot_code || '-'} · ${d.reporter || 'Residente'}`, url: () => '/emergencias',
  },
  'rounds.alert': {
    category: 'alerts', module: 'rounds', entity: 'round', priority: 'high', action: 'Ver ronda',
    title: () => '⚠ Alerta de ronda', body: (d) => d.message, url: () => '/rondas',
  },

  // ----- Expensas -----
  'expenses.published': {
    category: 'expenses', module: 'expenses', entity: 'expense_run', action: 'Ver expensas',
    title: () => '📄 Nueva liquidación disponible', body: () => 'Ya puede consultar la nueva liquidación de expensas.', url: () => '/expensas',
  },
  'expenses.due_soon': {
    category: 'expenses', module: 'expenses', entity: 'settlement', action: 'Pagar',
    title: () => '⏳ Vencimiento próximo',
    body: (d) => `Sus expensas vencen ${d.days <= 0 ? 'hoy' : d.days === 1 ? 'mañana' : `en ${d.days} días`}.`, url: () => '/expensas',
  },
  'expenses.overdue': {
    category: 'expenses', module: 'expenses', entity: 'settlement', priority: 'high', action: 'Pagar',
    title: () => '🔴 Expensa vencida', body: () => 'Tiene una expensa pendiente de pago.', url: () => '/expensas',
  },

  // ----- Reservas -----
  'reservations.confirmed': {
    category: 'reservations', module: 'reservations', entity: 'reservation', action: 'Ver reserva',
    title: () => '✅ Reserva confirmada', body: (d) => `Su reserva${d.space ? ` de ${d.space}` : ''} fue confirmada.`, url: () => '/reservas',
  },
  'reservations.cancelled': {
    category: 'reservations', module: 'reservations', entity: 'reservation', action: 'Ver reservas',
    title: () => '❌ Reserva cancelada', body: (d) => `Su reserva${d.space ? ` de ${d.space}` : ''} fue cancelada.`, url: () => '/reservas',
  },
  'reservations.reminder': {
    category: 'reservations', module: 'reservations', entity: 'reservation', action: 'Ver reserva',
    title: () => '📅 Recordatorio',
    body: (d) => `Tiene una reserva${d.space ? ` de ${d.space}` : ''} ${d.hours <= 2 ? 'en menos de 2 horas' : 'mañana'}.`, url: () => '/reservas',
  },

  // ----- Visitas -----
  'visits.approved': {
    category: 'visits', module: 'access', entity: 'visit', action: 'Ver visita',
    title: () => '✅ Invitación aprobada', body: (d) => `La invitación de ${name(d)} fue aprobada correctamente.`, url: () => '/visitas',
  },
  'visits.used': {
    category: 'visits', module: 'access', entity: 'visit', action: 'Ver acceso',
    title: () => '🎫 Invitación utilizada', body: (d) => `La invitación de ${name(d)} ha sido utilizada para el ingreso.`, url: () => '/visitas',
  },
  'visits.expiring': {
    category: 'visits', module: 'access', entity: 'visit', action: 'Ver invitación',
    title: () => '⏰ Invitación por vencer',
    body: (d) => `La invitación de ${name(d)} vencerá ${d.hours <= 1 ? 'en menos de 1 hora' : `en ${d.hours} horas`}.`, url: () => '/visitas',
  },

  // ----- Comunicaciones -----
  'announcements.new': {
    category: 'announcements', module: 'announcements', entity: 'announcement', action: 'Leer',
    title: () => '📢 Nuevo comunicado', body: (d) => d.title || 'Existe un nuevo comunicado para su complejo.', url: () => '/comunicados',
  },
  'announcements.message': {
    category: 'announcements', module: 'announcements', entity: 'announcement', action: 'Leer',
    title: () => '📣 Mensaje de administración', body: (d) => d.title || 'Ha recibido una nueva comunicación del administrador.',
    url: () => '/comunicados',
  },
  'system.test': {
    category: 'alerts', module: 'notifications', action: 'Abrir',
    title: () => '🔔 Notificación de prueba', body: () => 'Las notificaciones de este dispositivo funcionan correctamente.', url: () => '/notificaciones',
  },
};

/**
 * Arma la notificación final a partir del tipo y los datos del evento.
 * @param {string} type
 * @param {any} data
 */
export function render(type, data = {}) {
  const t = TEMPLATES[type];
  if (!t) { throw new Error(`Plantilla de notificación inexistente: ${type}`); }
  return {
    type,
    category: t.category,
    sourceModule: t.module,
    priority: t.priority || 'normal',
    title: t.title(data).slice(0, 160),
    body: t.body(data).slice(0, 500),
    actionUrl: t.url(data),
    actionLabel: t.action || null,
    entityType: t.entity || null,
  };
}
