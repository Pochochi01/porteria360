import { api } from './api';

const toKey = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

export async function registerPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) { return; }
  const { data } = await api.get('/auth/vapid-key');
  if (!data.key) { return; }
  if ((await Notification.requestPermission()) !== 'granted') { return; }
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(data.key) }));
  await api.post('/auth/push-subscription', sub.toJSON());
}
