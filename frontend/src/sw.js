import { precacheAndRoute } from 'workbox-precaching';

precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'AdminCountrys', {
      body: data.body,
      tag: data.tag,
      icon: '/icon-192.png',
      data: { url: data.url || '/' },
      requireInteraction: !!data.urgent,
      vibrate: data.urgent ? [400, 200, 400, 200, 400] : undefined,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((list) => {
      const c = list.find((w) => 'focus' in w);
      return c ? c.navigate(url).then((w) => w?.focus()) : self.clients.openWindow(url);
    })
  );
});
