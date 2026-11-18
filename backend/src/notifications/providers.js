// Transportes de envío. Misma interfaz para todos:
//   send(device, message) → { ok: true } | { gone: true } | { retry: true, error } | { error }
//  - gone:  el dispositivo ya no existe (se borra).   - retry: falla transitoria (se reintenta).
//
// Web Push (VAPID) es el estándar de la PWA: en Chrome/Android viaja por FCM, en Safari/iOS por APNs,
// en Firefox por Mozilla. No requiere el SDK de Firebase.
// FCM directo (HTTP v1) queda disponible para clientes nativos futuros: se activa con FCM_SERVICE_ACCOUNT_FILE.
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import jwt from 'jsonwebtoken';
import { BACKEND_ROOT } from '../lib/paths.js';

const TRANSIENT = (status) => !status || status === 429 || status >= 500;

// ---------- Web Push ----------
const vapid = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (vapid) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@localhost', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}

export const webPushProvider = {
  name: 'webpush',
  enabled: vapid,
  async send(device, msg) {
    try {
      await webpush.sendNotification(
        { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        JSON.stringify(msg.payload),
        { urgency: msg.urgency || 'normal', TTL: msg.ttl, topic: msg.topic },
      );
      return { ok: true };
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { return { gone: true }; }
      // Suscripción creada con otras claves VAPID: nunca va a funcionar con las actuales (el cliente se re-suscribe al abrir)
      if (e.statusCode === 403 && /do(es)? not correspond|mismatch|VapidPkHashMismatch/i.test(String(e.body))) { return { gone: true }; }
      const error = `webpush ${e.statusCode || e.code || ''} ${e.body || e.message}`.trim().slice(0, 300);
      return TRANSIENT(e.statusCode) ? { retry: true, error } : { error };
    }
  },
};

// ---------- FCM HTTP v1 (opcional) ----------
let account = null;
const accountFile = process.env.FCM_SERVICE_ACCOUNT_FILE;
if (accountFile) {
  try {
    account = JSON.parse(fs.readFileSync(path.resolve(BACKEND_ROOT, accountFile), 'utf8'));
  } catch (e) {
    console.error(`[notifications] FCM_SERVICE_ACCOUNT_FILE inválido (${e.message}): FCM desactivado`);
  }
}

let token = { value: null, exp: 0 };
/** Token OAuth2 de la cuenta de servicio (JWT firmado RS256 → access_token), cacheado ~55 min. */
async function accessToken() {
  if (token.value && Date.now() < token.exp) { return token.value; }
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    { iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: account.token_uri, iat: now, exp: now + 3600 },
    account.private_key, { algorithm: 'RS256' });
  const r = await fetch(account.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!r.ok) { throw Object.assign(new Error(`oauth ${r.status}`), { status: r.status }); }
  const j = await r.json();
  token = { value: j.access_token, exp: Date.now() + (j.expires_in - 300) * 1000 };
  return token.value;
}

/** FCM solo acepta strings en `data`. */
const strings = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));

export const fcmProvider = {
  name: 'fcm',
  enabled: !!account,
  async send(device, msg) {
    try {
      const p = msg.payload;
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: device.fcm_token,
            notification: { title: p.title, body: p.body, ...(p.image ? { image: p.image } : {}) },
            data: strings({ url: p.url, nid: p.nid, rt: p.rt, tenantId: p.tenantId, entityType: p.entityType, entityId: p.entityId, type: p.type }),
            android: { priority: msg.urgency === 'high' ? 'HIGH' : 'NORMAL', ttl: `${msg.ttl}s`, collapse_key: msg.topic },
            apns: { headers: { 'apns-priority': msg.urgency === 'high' ? '10' : '5' } },
          },
        }),
      });
      if (r.ok) { return { ok: true }; }
      const body = await r.text();
      if (r.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(body)) { return { gone: true }; }
      const error = `fcm ${r.status} ${body}`.slice(0, 300);
      return TRANSIENT(r.status) ? { retry: true, error } : { error };
    } catch (e) {
      return { retry: true, error: `fcm ${e.message}`.slice(0, 300) };
    }
  },
};

export const providers = { webpush: webPushProvider, fcm: fcmProvider };
export const pushEnabled = () => webPushProvider.enabled || fcmProvider.enabled;
