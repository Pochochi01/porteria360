import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { tx } from './db.js';
import { RECEIPTS_DIR } from './paths.js';
import { ah, audit, validate, HttpError, toSql, parseSql } from './helpers.js';
import { requireRole } from '../middleware/auth.js';

/** Todos los modelos registrados (se usan también para generar la documentación OpenAPI). */
export const registry = [];

/**
 * Define un modelo editable/eliminable. Opciones:
 *  path, table, label, entity          ruta (sin /api), tabla, nombre legible, entidad para audit_log
 *  tenantScoped (true)                 filtra por req.tenantId
 *  editRoles, deleteRoles (['admin'])  roles permitidos; deleteRoles: null = sin DELETE
 *  update                              schema zod (objeto) de campos editables
 *  canAccess(row, req)                 control extra de acceso (lanza HttpError)
 *  beforeUpdate(c, row, body, req)     devuelve las columnas a escribir
 *  dependencies(c, row, req)           [{ label, count, block? }] registros relacionados
 *  cascade(c, row, req)                borra dependencias; puede devolver { files: [...] }
 *  afterDelete(c, row, req)
 *  hidden                              columnas que nunca se devuelven
 */
export function defineModel(m) {
  const model = { tenantScoped: true, deleteRoles: ['admin'], hidden: [], ...m };
  registry.push(model);
  return model;
}

export const count = async (c, sql, params) => Number((await c.execute(sql, params))[0][0].n);

// Helpers de validación compartidos por los modelos
export const zDateTime = z.string().refine((s) => !isNaN(parseSql(s)), 'Fecha/hora inválida').transform((s) => toSql(parseSql(s)));
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD');
export const zTime = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Formato HH:MM');
export const zOptText = (max) => z.string().trim().max(max).nullable().transform((s) => (s === '' ? null : s));

const strip = (row, hidden) => Object.fromEntries(Object.entries(row).filter(([k]) => !hidden.includes(k)));
const diff = (a, b, hidden) =>
  Object.fromEntries(
    Object.keys(b)
      .filter((k) => !hidden.includes(k) && String(a[k]) !== String(b[k]))
      .map((k) => [k, { antes: a[k], despues: b[k] }])
  );

async function load(c, m, req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { throw new HttpError(400, 'Id inválido'); }
  const [rows] = m.tenantScoped
    ? await c.execute(`SELECT * FROM ${m.table} WHERE id=? AND tenant_id=? FOR UPDATE`, [id, req.tenantId])
    : await c.execute(`SELECT * FROM ${m.table} WHERE id=? FOR UPDATE`, [id]);
  if (!rows[0]) { throw new HttpError(404, `${m.label} no encontrado`); }
  if (m.canAccess) { await m.canAccess(rows[0], req); }
  return rows[0];
}

/** Monta PUT /<path>/:id y DELETE /<path>/:id en el router. */
export function mountModel(router, m) {
  if (m.update) {
    router.put(`/${m.path}/:id`, requireRole(...m.editRoles), validate(m.update.strict()), ah(async (req, res) => {
      if (!Object.keys(req.body).length) { throw new HttpError(400, 'No se enviaron cambios'); }
      const { before, after } = await tx(async (c) => {
        const row = await load(c, m, req);
        const changes = m.beforeUpdate ? await m.beforeUpdate(c, row, req.body, req) : req.body;
        const cols = Object.keys(changes);
        if (cols.length) { await c.execute(`UPDATE ${m.table} SET ${cols.map((k) => `\`${k}\`=?`).join(',')} WHERE id=?`, [...cols.map((k) => changes[k]), row.id]); }
        const [[updated]] = await c.execute(`SELECT * FROM ${m.table} WHERE id=?`, [row.id]);
        return { before: row, after: updated };
      });
      await audit(req, m.entity, after.id, 'update', diff(before, after, m.hidden));
      res.json(strip(after, m.hidden));
    }));
  }

  if (m.deleteRoles) {
    router.delete(`/${m.path}/:id`, requireRole(...m.deleteRoles), ah(async (req, res) => {
      const force = ['1', 'true'].includes(String(req.query.force));
      const { row, deps, files } = await tx(async (c) => {
        const row = await load(c, m, req);
        const deps = (m.dependencies ? await m.dependencies(c, row, req) : []).filter((d) => d.count > 0);
        const blocked = deps.filter((d) => d.block);
        if (blocked.length) {
          throw new HttpError(409, `No se puede eliminar: tiene ${blocked.map((d) => `${d.count} ${d.label}`).join(', ')}. Reasígnelos o elimínelos primero.`,
            { dependencies: deps, blocked: true });
        }
        if (deps.length && !force) {
          throw new HttpError(409, `Tiene registros relacionados: ${deps.map((d) => `${d.count} ${d.label}`).join(', ')}`,
            { dependencies: deps, requiresForce: true });
        }
        const extra = m.cascade ? (await m.cascade(c, row, req)) || {} : {};
        await c.execute(`DELETE FROM ${m.table} WHERE id=?`, [row.id]);
        if (m.afterDelete) { await m.afterDelete(c, row, req); }
        return { row, deps, files: extra.files || [] };
      });
      // Los archivos se borran recién después del commit
      await Promise.all(files.filter(Boolean).map((f) => fs.unlink(path.join(RECEIPTS_DIR, path.basename(f))).catch(() => {})));
      await audit(req, m.entity, row.id, 'delete', { registro: strip(row, m.hidden), cascada: deps });
      res.json({ ok: true, deleted: row.id, cascade: deps });
    }));
  }
}
