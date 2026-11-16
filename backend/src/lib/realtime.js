import { Server } from 'socket.io';
import webpush from 'web-push';
import { verifyToken } from '../middleware/auth.js';
import { query } from './db.js';
import { corsOrigin } from './origins.js';

let io;

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}

/**
 * Salas: tenant:<id>, tenant:<id>:role:<rol>, user:<id>.
 * El socket se autentica con el mismo JWT, así un tenant nunca recibe eventos de otro.
 */
export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: corsOrigin },
    pingInterval: 25000,
    pingTimeout: 20000,
  });
  io.use((socket, next) => {
    try {
      socket.user = verifyToken(socket.handshake.auth?.token);
      next();
    } catch {
      const err = new Error('unauthorized');
      err.data = { code: 'unauthorized' }; // el cliente deja de reintentar
      next(err);
    }
  });
  io.on('connection', (socket) => {
    const { sub, tenant_id, roles } = socket.user;
    socket.join(`tenant:${tenant_id}`);
    socket.join(`user:${sub}`);
    roles.forEach((r) => socket.join(`tenant:${tenant_id}:role:${r}`));
  });
  return io;
}

export const emitToRoles = (tenantId, roles, event, payload) =>
  roles.forEach((r) => io?.to(`tenant:${tenantId}:role:${r}`).emit(event, payload));

export const emitToUser = (userId, event, payload) => io?.to(`user:${userId}`).emit(event, payload);

export async function pushToUsers(tenantId, userIds, payload) {
  if (!userIds.length || !process.env.VAPID_PUBLIC_KEY) { return; }
  const subs = await query(
    `SELECT * FROM push_subscriptions WHERE tenant_id=? AND user_id IN (${userIds.map(() => '?').join(',')})`,
    [tenantId, ...userIds]
  );
  await Promise.all(
    subs.map((s) =>
      webpush
        .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
          urgency: payload.urgent ? 'high' : 'normal',
        })
        .catch((e) => {
          if (e.statusCode === 404 || e.statusCode === 410) { return query('DELETE FROM push_subscriptions WHERE id=?', [s.id]); }
        })
    )
  );
}

export async function pushToRoles(tenantId, roles, payload) {
  const users = await query(
    `SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
     WHERE u.tenant_id=? AND u.active=1 AND r.name IN (${roles.map(() => '?').join(',')})`,
    [tenantId, ...roles]
  );
  await pushToUsers(tenantId, users.map((u) => u.id), payload);
}

export async function lotUserIds(tenantId, lotId) {
  const rows = await query('SELECT id FROM users WHERE tenant_id=? AND lot_id=? AND active=1', [tenantId, lotId]);
  return rows.map((r) => r.id);
}
