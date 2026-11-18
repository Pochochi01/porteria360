// Archivos de cada complejo (tabla tenant_assets).
//  - Públicos (logo, portada, video, galería): uploads/tenants/<tenant>/…, servidos sin login.
//  - Privados (kind 'document': comprobantes de gastos): uploads/private/<tenant>/…, solo por endpoint con permisos.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { query } from './db.js';
import { HttpError } from './helpers.js';

import { UPLOADS, PRIVATE_UPLOADS } from './paths.js';

export { UPLOADS, PRIVATE_UPLOADS };

export const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
export const VIDEO_MIME = ['video/mp4', 'video/webm'];
export const DOCUMENT_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export const LIMITS = { logo: 2, cover: 10, image: 10, video: 50, document: 10 }; // MB

export const publicUrl = (p) => (p ? `/uploads/tenants/${p}` : null);
const baseDir = (isPrivate) => (isPrivate ? PRIVATE_UPLOADS : UPLOADS);

/**
 * Valida, optimiza y guarda un archivo; lo registra en tenant_assets.
 * Imágenes → WebP (sin agrandar); logo SVG, videos y PDF se guardan tal cual.
 * @param {number} tenantId
 * @param {'logo'|'cover'|'video'|'image'|'document'} kind
 * @param {{ buffer: Buffer, mimetype: string, size: number }} file archivo de multer (memoria)
 */
export async function storeAsset(tenantId, kind, file) {
  if (!file) { throw new HttpError(400, 'Archivo requerido'); }
  const isPrivate = kind === 'document';
  const isVideo = VIDEO_MIME.includes(file.mimetype);
  if (isPrivate) {
    if (!DOCUMENT_MIME.includes(file.mimetype)) { throw new HttpError(415, 'El comprobante debe ser PDF, JPG, PNG o WebP'); }
  } else if ((kind === 'video') !== isVideo) {
    throw new HttpError(400, kind === 'video' ? 'El video debe ser MP4 o WebM' : 'Se esperaba una imagen');
  }
  if (file.mimetype === 'image/svg+xml' && kind !== 'logo') { throw new HttpError(400, 'SVG solo se admite para el logo'); }
  if (file.size > LIMITS[kind] * 1024 * 1024) { throw new HttpError(413, `El archivo supera ${LIMITS[kind]} MB`); }

  const dir = path.join(baseDir(isPrivate), String(tenantId));
  await fs.mkdir(dir, { recursive: true });
  const id = crypto.randomUUID();
  let name, mime, data, width = null, height = null;
  if (isVideo) {
    name = `${kind}-${id}${file.mimetype === 'video/webm' ? '.webm' : '.mp4'}`;
    mime = file.mimetype;
    data = file.buffer;
  } else if (file.mimetype === 'application/pdf') {
    // El mimetype lo declara el cliente: se verifica la firma real del PDF
    if (file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') { throw new HttpError(415, 'El archivo no es un PDF válido'); }
    name = `${kind}-${id}.pdf`;
    mime = 'application/pdf';
    data = file.buffer;
  } else if (file.mimetype === 'image/svg+xml') {
    // SVG: se rechaza si trae scripts o handlers (evita XSS al servirlo)
    const svg = file.buffer.toString('utf8');
    if (/<script|on\w+\s*=|javascript:/i.test(svg)) { throw new HttpError(400, 'El SVG contiene código no permitido'); }
    name = `${kind}-${id}.svg`;
    mime = 'image/svg+xml';
    data = file.buffer;
  } else {
    const max = kind === 'logo' ? 512 : 2400;
    const quality = { logo: 90, document: 85 }[kind] ?? 78; // comprobantes: texto legible
    try {
      const img = sharp(file.buffer, { failOn: 'error' }).rotate().resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true });
      data = await img.webp({ quality }).toBuffer();
    } catch {
      throw new HttpError(415, 'La imagen está dañada o no es válida');
    }
    ({ width, height } = await sharp(data).metadata());
    name = `${kind}-${id}.webp`;
    mime = 'image/webp';
  }
  await fs.writeFile(path.join(dir, name), data);
  const rel = `${tenantId}/${name}`;
  const r = await query('INSERT INTO tenant_assets (tenant_id,kind,path,mime,size,width,height,private) VALUES (?,?,?,?,?,?,?,?)',
    [tenantId, kind, rel, mime, data.length, width, height, isPrivate ? 1 : 0]);
  return { id: r.insertId, path: rel, url: isPrivate ? null : publicUrl(rel), mime, width, height };
}

/**
 * Borra el registro y el archivo (público o privado).
 * @param {import('mysql2/promise').PoolConnection} [conn] conexión de la transacción en curso, si la hay
 *   (con otra conexión, el SET NULL de las FKs esperaría el bloqueo de la propia transacción)
 */
export async function removeAsset(tenantId, assetId, conn) {
  const exec = conn ? async (sql, p) => (await conn.execute(sql, p))[0] : query;
  const [a] = await exec('SELECT path, private FROM tenant_assets WHERE id=? AND tenant_id=?', [assetId, tenantId]);
  if (!a) { return; }
  await exec('DELETE FROM tenant_assets WHERE id=?', [assetId]); // FKs: SET NULL / CASCADE según la tabla
  await fs.unlink(path.join(baseDir(a.private), a.path)).catch(() => {});
}

/**
 * Envía un archivo privado. El llamador ya verificó los permisos.
 * @param {import('express').Response} res
 * @param {number} tenantId
 * @param {number} assetId
 * @param {string} [downloadName] nombre sugerido (sin extensión)
 */
export async function sendAsset(res, tenantId, assetId, downloadName) {
  const [a] = await query('SELECT path, mime, private FROM tenant_assets WHERE id=? AND tenant_id=?', [assetId, tenantId]);
  if (!a) { throw new HttpError(404, 'Archivo no encontrado'); }
  const file = path.join(baseDir(a.private), a.path);
  const ext = path.extname(a.path);
  const safe = String(downloadName || 'comprobante').replace(/[^\w.-]+/g, '_').slice(0, 80);
  res.set({
    'Content-Type': a.mime,
    'Content-Disposition': `inline; filename="${safe}${ext}"`,
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  });
  res.sendFile(file);
}

/** Borra todos los archivos de un complejo (al eliminarlo). */
export const removeTenantFiles = (tenantId) => Promise.all([UPLOADS, PRIVATE_UPLOADS].map((d) =>
  fs.rm(path.join(d, String(tenantId)), { recursive: true, force: true })));
