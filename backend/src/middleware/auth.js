import jwt from 'jsonwebtoken';

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, tenant_id: user.tenant_id, roles: user.roles, lot_id: user.lot_id ?? null },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES || '12h' }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

/**
 * Valida el JWT y fija req.user / req.tenantId.
 * Todas las consultas deben filtrar por req.tenantId: el tenant SIEMPRE
 * sale del token, nunca del body ni de la query string.
 */
export function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) { return res.status(401).json({ error: 'Token requerido' }); }
  try {
    const p = verifyToken(token);
    req.user = { id: p.sub, tenant_id: p.tenant_id, roles: p.roles || [], lot_id: p.lot_id };
    req.tenantId = p.tenant_id;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

export const requireRole = (...allowed) => (req, res, next) =>
  req.user?.roles.some((r) => allowed.includes(r))
    ? next()
    : res.status(403).json({ error: 'Permiso denegado' });

export const hasRole = (req, ...roles) => req.user.roles.some((r) => roles.includes(r));
