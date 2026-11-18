import { api } from './api';
import { detectPlatform } from './pwa';

const toKey = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** 'granted' | 'denied' | 'default' | 'unsupported' */
export const pushPermission = () => (pushSupported() ? Notification.permission : 'unsupported');

/** Suscripción Web Push actual de este navegador (o null). */
export async function currentSubscription() {
  if (!pushSupported()) { return null; }
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) || null;
}

async function subscribe() {
  const { data } = await api.get('/auth/vapid-key');
  if (!data.key) { return false; }
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(data.key) }));
  // Registra el dispositivo (varios por usuario). La plataforma la detecta el cliente: iPadOS se presenta como Mac.
  await api.post('/notifications/devices', { ...sub.toJSON(), platform: detectPlatform() });
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

/**
 * Al cerrar sesión: este dispositivo deja de recibir los avisos de esa cuenta.
 * (La suscripción del navegador se conserva: si otra persona inicia sesión, se vincula a ella.)
 */
export async function unlinkPush() {
  const sub = await currentSubscription().catch(() => null);
  if (sub) { await api.delete('/notifications/devices/current', { data: { endpoint: sub.endpoint } }).catch(() => {}); }
}
