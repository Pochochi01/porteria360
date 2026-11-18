import { Server } from 'socket.io';
import { verifyToken } from '../middleware/auth.js';
import { query } from './db.js';
import { corsOrigin } from './origins.js';

let io;

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

// Las notificaciones push se envían desde src/notifications (eventos → cola → dispositivos).

export async function lotUserIds(tenantId, lotId) {
  const rows = await query('SELECT id FROM users WHERE tenant_id=? AND lot_id=? AND active=1', [tenantId, lotId]);
  return rows.map((r) => r.id);
}
