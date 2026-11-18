// Módulo de notificaciones: arranque y apagado (lo usa server.js).
// Estructura:
//   events.js       EventNotificationManager  · eventos de negocio → destinatarios + plantilla
//   service.js      NotificationService       · preferencias → cola → aviso en vivo
//   templates.js    NotificationTemplates     · textos, categoría, prioridad, deep link
//   preferences.js  NotificationPreferencesService
//   subscriptions.js PushSubscriptionService  · dispositivos (Web Push / FCM)
//   repository.js   NotificationRepository    · SQL (historial + cola)
//   queue.js        NotificationQueue         · envío en segundo plano con reintentos
//   dispatcher.js   NotificationDispatcher    · una notificación → todos los dispositivos
//   providers.js    transportes Web Push (VAPID) y FCM HTTP v1
//   scheduler.js    recordatorios (expensas, reservas, invitaciones)
import { start, stop } from './queue.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { fcmProvider, webPushProvider } from './providers.js';

export function startNotifications() {
  start();
  startScheduler();
  const channels = [webPushProvider.enabled && 'Web Push', fcmProvider.enabled && 'FCM'].filter(Boolean);
  console.log(`[notifications] cola activa · canales: ${channels.join(', ') || 'ninguno (faltan VAPID_* en .env): solo bandeja en la app'}`);
}

export async function stopNotifications() {
  stopScheduler();
  await stop();
}
