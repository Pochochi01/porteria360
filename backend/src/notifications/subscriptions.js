// PushSubscriptionService: dispositivos registrados (tabla push_subscriptions). Varios por usuario.
// Un mismo dispositivo (endpoint o token FCM) pertenece a una sola sesión: si otro usuario inicia
// sesión en él, el registro pasa a ese usuario y el anterior deja de recibir sus avisos ahí.
import { query } from '../lib/db.js';

/** Datos legibles del dispositivo a partir del User-Agent (sin librerías: solo lo necesario para el listado). */
export function describeAgent(ua = '') {
  const platform = /iPhone|iPad|iPod/.test(ua) ? 'ios' : /Android/.test(ua) ? 'android' : /Windows|Macintosh|Linux|CrOS/.test(ua) ? 'desktop' : 'other';
  const browser = /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /OPR\//.test(ua) ? 'Opera'
    : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? (ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/)?.[1]?.trim() || 'Android')
      : /Windows/.test(ua) ? 'Windows' : /Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'Dispositivo';
  return { platform, browser, device: device.slice(0, 60) };
}

/**
 * Registra o actualiza el dispositivo actual.
 * @param {{ tenantId: number, userId: number, userAgent?: string, platform?: string }} who
 * @param {{ endpoint?: string, keys?: { p256dh: string, auth: string }, fcmToken?: string }} sub
 */
export async function register(who, sub) {
  const info = describeAgent(who.userAgent);
  const platform = ['ios', 'android', 'desktop'].includes(who.platform) ? who.platform : info.platform;
  if (sub.fcmToken) {
    await query(
      `INSERT INTO push_subscriptions (tenant_id,user_id,channel,fcm_token,platform,browser,device,last_seen)
       VALUES (?,?,'fcm',?,?,?,?,NOW())
       ON DUPLICATE KEY UPDATE tenant_id=VALUES(tenant_id), user_id=VALUES(user_id), platform=VALUES(platform),
         browser=VALUES(browser), device=VALUES(device), last_seen=NOW()`,
      [who.tenantId, who.userId, sub.fcmToken, platform, info.browser, info.device]);
  } else {
    await query(
      `INSERT INTO push_subscriptions (tenant_id,user_id,channel,endpoint,p256dh,auth,platform,browser,device,last_seen)
       VALUES (?,?,'webpush',?,?,?,?,?,?,NOW())
       ON DUPLICATE KEY UPDATE tenant_id=VALUES(tenant_id), user_id=VALUES(user_id), p256dh=VALUES(p256dh), auth=VALUES(auth),
         platform=VALUES(platform), browser=VALUES(browser), device=VALUES(device), last_seen=NOW()`,
      [who.tenantId, who.userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, platform, info.browser, info.device]);
  }
}

/**
 * El service worker renovó la suscripción (pushsubscriptionchange). El endpoint anterior es una URL
 * secreta e imposible de adivinar: solo el navegador que la tenía puede presentarla.
 * @returns {Promise<boolean>}
 */
export async function rotate(oldEndpoint, sub) {
  const r = await query(
    `UPDATE push_subscriptions SET endpoint=?, p256dh=?, auth=?, last_seen=NOW() WHERE endpoint=? AND channel='webpush'`,
    [sub.endpoint, sub.keys.p256dh, sub.keys.auth, oldEndpoint]);
  return r.affectedRows > 0;
}

/** Quita el dispositivo actual del usuario (al cerrar sesión o desactivar avisos). */
export async function unregister(userId, { endpoint, fcmToken }) {
  const r = await query('DELETE FROM push_subscriptions WHERE user_id=? AND (endpoint=? OR fcm_token=?)', [userId, endpoint ?? null, fcmToken ?? null]);
  return r.affectedRows > 0;
}

export const listForUser = (tenantId, userId) => query(
  `SELECT id, channel, platform, browser, device, created_at, last_seen, endpoint FROM push_subscriptions
    WHERE tenant_id=? AND user_id=? ORDER BY COALESCE(last_seen, created_at) DESC`, [tenantId, userId]);

export async function removeById(tenantId, userId, id) {
  const r = await query('DELETE FROM push_subscriptions WHERE id=? AND tenant_id=? AND user_id=?', [id, tenantId, userId]);
  return r.affectedRows > 0;
}

/** Dispositivos de un usuario para el envío. */
export const devicesOf = (tenantId, userId) =>
  query('SELECT * FROM push_subscriptions WHERE tenant_id=? AND user_id=?', [tenantId, userId]);

/** El proveedor informó que el dispositivo ya no existe (desinstalado, permiso revocado). */
export const removeDead = (id) => query('DELETE FROM push_subscriptions WHERE id=?', [id]);
