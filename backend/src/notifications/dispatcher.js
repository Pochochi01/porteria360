// NotificationDispatcher: entrega UNA notificación en todos los dispositivos de su destinatario.
import crypto from 'node:crypto';
import { providers } from './providers.js';
import { devicesOf, removeDead } from './subscriptions.js';

const secret = () => process.env.JWT_SECRET || 'dev';

/** Firma corta que permite al service worker informar la lectura sin enviar la sesión del usuario. */
export const readToken = (id) => crypto.createHmac('sha256', secret()).update(`notification:${id}`).digest('base64url').slice(0, 22);
export const checkReadToken = (id, token) => {
  const a = Buffer.from(readToken(id));
  const b = Buffer.from(String(token || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/** Contenido que recibe el service worker (máx. ~4 KB en Web Push). */
export function buildPayload(n) {
  return {
    title: n.title,
    body: n.body,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    image: n.image_url || undefined,
    url: n.action_url,
    actionLabel: n.action_label || undefined,
    tag: n.entity_id ? `${n.type}:${n.entity_id}` : `n:${n.id}`, // la misma entidad reemplaza su aviso anterior
    urgent: n.priority === 'high',
    nid: n.id,
    rt: readToken(n.id),
    tenantId: n.tenant_id,
    entityType: n.entity_type || undefined,
    entityId: n.entity_id || undefined,
    type: n.type,
  };
}

/**
 * @param {any} n fila de notifications
 * @returns {Promise<{ devices: number, delivered: number[], transientError?: string, error?: string }>}
 */
export async function dispatch(n) {
  const all = await devicesOf(n.tenant_id, n.user_id);
  const done = new Set(Array.isArray(n.delivered_to) ? n.delivered_to : JSON.parse(n.delivered_to || '[]'));
  const pending = all.filter((d) => !done.has(d.id));
  const msg = {
    payload: buildPayload(n),
    priority: n.priority,
    ttl: n.priority === 'high' ? 3600 : 86400, // un aviso urgente viejo no sirve; uno informativo, hasta un día
    topic: `n${n.id}`,
  };
  const errors = [];
  let transient = null;
  for (const d of pending) {
    const p = providers[d.channel || 'webpush'];
    if (!p?.enabled) { errors.push(`${d.channel}: canal no configurado`); continue; }
    const r = await p.send(d, msg);
    if (r.ok) { done.add(d.id); } else if (r.gone) {
      await removeDead(d.id);
    } else if (r.retry) { transient = r.error; } else { errors.push(r.error); }
  }
  // Los dispositivos dados de baja no cuentan como fallidos
  const alive = (await devicesOf(n.tenant_id, n.user_id)).length;
  return { devices: Math.max(alive, done.size), delivered: [...done], transientError: transient || undefined, error: errors[0] };
}
