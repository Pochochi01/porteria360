import { query } from './db.js';

// Envuelve handlers async para enviar errores al middleware central.
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export class HttpError extends Error {
  constructor(status, message, extra = undefined) {
    super(message);
    this.status = status;
    this.extra = extra; // datos adicionales para el cliente (p. ej. dependencias)
  }
}

// Valida el body con un schema zod; responde 400 si falla.
export const validate = (schema) => (req, res, next) => {
  const r = schema.safeParse(req.body);
  if (!r.success) {
    const fields = r.error.issues.map((i) => ({ field: i.path.join('.') || '(body)', message: i.message }));
    return res.status(400).json({
      error: `Datos inválidos: ${fields.map((f) => `${f.field} → ${f.message}`).join('; ')}`,
      fields,
    });
  }
  req.body = r.data;
  next();
};

export async function audit(req, entity, entityId, action, data = null) {
  await query(
    'INSERT INTO audit_log (tenant_id,user_id,entity,entity_id,action,data,ip) VALUES (?,?,?,?,?,?,?)',
    [req.tenantId, req.user?.id ?? null, entity, entityId, action, data ? JSON.stringify(data) : null, req.ip]
  );
}

// Convención: los DATETIME se guardan en hora local del complejo (variable TZ del proceso).
const pad = (n) => String(n).padStart(2, '0');
export const toSql = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
export const nowSql = () => toSql(new Date());
export const parseSql = (s) => new Date(String(s).replace(' ', 'T'));
