import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';

// registerType "autoUpdate" con injectManifest: el SW nuevo se activa apenas se instala y toma control de las
// ventanas abiertas. Sin esto queda "esperando" hasta cerrar TODAS las pestañas y la app instalada, y los
// usuarios siguen recibiendo push con el código viejo.
self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
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

// El navegador renovó la suscripción (vencimiento o rotación del push service) con la app cerrada:
// se suscribe de nuevo y se informa al servidor usando el endpoint anterior como prueba de propiedad.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const old = event.oldSubscription;
    const key = old?.options?.applicationServerKey;
    const sub = event.newSubscription || (key ? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : null);
    if (!old?.endpoint || !sub) { return; } // sin datos: la app re-suscribe al abrirse (syncPush)
    await fetch('/api/notifications/devices/rotate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ oldEndpoint: old.endpoint, subscription: sub.toJSON() }),
    }).catch(() => {});
  })());
});

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
      // Primero la navegación: si el navegador rechaza focus(), el usuario igual llega al detalle
      client.postMessage({ type: 'navigate', url: d.url || '/' });
      await client.focus().catch(() => {});
      return;
    }
    await self.clients.openWindow(target);
  })();
  event.waitUntil(Promise.all([open, receipt(d)]));
});
