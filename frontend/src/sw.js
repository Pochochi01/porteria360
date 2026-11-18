import { precacheAndRoute } from 'workbox-precaching';

precacheAndRoute(self.__WB_MANIFEST);

// Notificaciones push. El servidor envía: title, body, icon, badge, image, url, actionLabel, tag,
// urgent, nid (id de la notificación), rt (firma para informar la lectura), tenantId, entityType, entityId.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  const options = {
    body: data.body,
    tag: data.tag,
    renotify: !!data.tag, // misma entidad: reemplaza el aviso anterior pero vuelve a sonar
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/badge-72.png',
    image: data.image,
    timestamp: Date.now(),
    data: { url: data.url || '/', nid: data.nid, rt: data.rt, entityType: data.entityType, entityId: data.entityId },
    requireInteraction: !!data.urgent,
    vibrate: data.urgent ? [400, 200, 400, 200, 400] : [120, 80, 120],
    // Botones (Android y escritorio; iOS los ignora y abre con el toque)
    actions: data.actionLabel ? [{ action: 'open', title: data.actionLabel }] : [],
  };
  event.waitUntil(self.registration.showNotification(data.title || 'AdminCountrys', options));
});

/** Informa la lectura sin sesión (la firma rt la valida el servidor). Nunca bloquea la apertura. */
const receipt = (d) => (d?.nid && d?.rt
  ? fetch('/api/notifications/receipt', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: d.nid, rt: d.rt }), keepalive: true,
  }).catch(() => {})
  : Promise.resolve());

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const target = new URL(d.url || '/', self.location.origin).href;
  // focus()/openWindow() van primero: el navegador solo los permite durante el gesto del usuario
  const open = (async () => {
    // App abierta (instalada o en una pestaña): se enfoca y navega con su router, sin recargar ni perder estado
    // (ver useServiceWorkerNavigation). Si no, se abre en la ruta del aviso; la sesión sigue en localStorage.
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = list.find((c) => new URL(c.url).origin === self.location.origin);
    if (client) {
      await client.focus();
      client.postMessage({ type: 'navigate', url: d.url || '/' });
      return;
    }
    await self.clients.openWindow(target);
  })();
  event.waitUntil(Promise.all([open, receipt(d)]));
});
