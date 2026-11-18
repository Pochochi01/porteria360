import { api } from './api';

const toKey = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** 'granted' | 'denied' | 'default' | 'unsupported' */
export const pushPermission = () => (pushSupported() ? Notification.permission : 'unsupported');

async function subscribe() {
  const { data } = await api.get('/auth/vapid-key');
  if (!data.key) { return false; }
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(data.key) }));
  await api.post('/auth/push-subscription', sub.toJSON());
  return true;
}

/**
 * Al iniciar sesión: renueva la suscripción SOLO si el usuario ya dio permiso antes.
 * Nunca muestra el diálogo del navegador.
 */
export async function syncPush() {
  if (pushPermission() !== 'granted') { return false; }
  return subscribe();
}

/**
 * Pide permiso y suscribe. Llamar únicamente desde un gesto del usuario (click),
 * requisito de Safari iOS y buena práctica en el resto.
 * @returns {Promise<'granted'|'denied'|'default'|'unsupported'>}
 */
export async function enablePush() {
  if (!pushSupported()) { return 'unsupported'; }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') { await subscribe(); }
  return perm;
}
