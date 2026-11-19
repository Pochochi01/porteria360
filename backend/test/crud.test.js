// Pruebas de integración de edición (PUT) y eliminación definitiva (DELETE).
// Uso: npm test   (usa la base del .env; crea y borra un complejo y un superadmin de prueba)
import '../src/lib/env.js';
import { UPLOADS_ROOT } from '../src/lib/paths.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import http from 'node:http';
import { query, pool } from '../src/lib/db.js';

const PORT = 4200;
const B = `http://127.0.0.1:${PORT}/api`;
const SA = { email: `sa-test-${Date.now()}@test.local`, password: 'superadmin-test-123' };
const SLUG = `test-crud-${Date.now()}`;
let server, saId, tenantId;
// MercadoPago simulado: preferencias y consulta de pagos
const MP_PORT = 4299;
const mp = { payments: {}, lastPreference: null };
const mpServer = http.createServer((rq, rs) => {
  let body = '';
  rq.on('data', (c) => { body += c; }).on('end', () => {
    rs.setHeader('Content-Type', 'application/json');
    if (rq.method === 'POST' && rq.url === '/checkout/preferences') {
      mp.lastPreference = JSON.parse(body);
      return rs.end(JSON.stringify({ id: 'PREF-1', init_point: 'https://mp.test/checkout' }));
    }
    const id = rq.url.startsWith('/v1/payments/') ? decodeURIComponent(rq.url.slice('/v1/payments/'.length)) : null;
    if (id && mp.payments[id]) { return rs.end(JSON.stringify(mp.payments[id])); }
    rs.statusCode = 404;
    rs.end('{}');
  });
});
const tok = {}; // tokens por rol
const ids = {};

async function call(method, path, { token, body, expect } = {}) {
  const res = await fetch(B + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (expect !== undefined) { assert.equal(res.status, expect, `${method} ${path} → ${res.status} ${JSON.stringify(data)}`); }
  return data;
}
const login = (email, password, tenant = SLUG) => call('POST', '/auth/login', { body: { tenant, email, password }, expect: 200 }).then((d) => d.token);
const one = async (sql, p) => (await query(sql, p))[0];

before(async () => {
  // Superadmin de prueba directo en la base
  const [plat] = await query("SELECT id FROM tenants WHERE slug='plataforma'");
  assert.ok(plat, 'Falta el tenant plataforma: ejecutá npm run create:superadmin');
  const r = await query('INSERT INTO users (tenant_id,email,password_hash,full_name) VALUES (?,?,?,?)',
    [plat.id, SA.email, await bcrypt.hash(SA.password, 10), 'SA Test']);
  saId = r.insertId;
  await query("INSERT INTO user_roles SELECT ?, id FROM roles WHERE name='superadmin'", [saId]);

  await new Promise((resolve) => { mpServer.listen(MP_PORT, '127.0.0.1', resolve); });
  server = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test', MP_API_BASE: `http://127.0.0.1:${MP_PORT}`, MP_WEBHOOK_SECRET: '',
      PUBLIC_API_URL: 'https://api.test', PUBLIC_APP_URL: 'https://app.test' },
    stdio: 'pipe',
  });
  server.stderr.on('data', (d) => process.stderr.write(d));
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${B}/health`)).ok) { return; }
    } catch { /* todavía no levantó: reintenta */ }
    await new Promise((r) => { setTimeout(r, 200); });
  }
  throw new Error('El backend de prueba no arrancó');
});

after(async () => {
  server?.kill();
  mpServer.close();
  if (tenantId) { // por si algún test falló antes de borrar el complejo
    const t = await one('SELECT id FROM tenants WHERE id=?', [tenantId]);
    if (t) { await call('DELETE', `/platform/tenants/${tenantId}?force=1`, { token: tok.sa }); }
  }
  await query('DELETE FROM audit_log WHERE user_id=? AND entity=?', [saId, 'tenant']);
  await query('DELETE FROM users WHERE id=?', [saId]);
  await pool.end();
});

test('setup: complejo de prueba y usuarios por rol', async () => {
  tok.sa = await login(SA.email, SA.password, '');
  tenantId = (await call('POST', '/platform/tenants', { token: tok.sa, expect: 201,
    body: { name: 'Test CRUD', slug: SLUG, admin_name: 'Admin Test', admin_email: 'admin@test.local', admin_password: 'admin-test-123' } })).id;
  tok.admin = await login('admin@test.local', 'admin-test-123');
  ids.lot = (await call('POST', '/lots', { token: tok.admin, body: { code: 'A-1' }, expect: 201 })).id;
  ids.lot2 = (await call('POST', '/lots', { token: tok.admin, body: { code: 'A-2' }, expect: 201 })).id;
  const mk = (role, email, extra = {}) => call('POST', '/users', { token: tok.admin, expect: 201,
    body: { role, email, password: 'clave-1234', full_name: `${role} test`, ...extra } }).then((d) => d.id);
  ids.owner = await mk('owner', 'owner@test.local', { lot_id: ids.lot });
  ids.guard = await mk('guard', 'guard@test.local');
  ids.supervisor = await mk('supervisor', 'sup@test.local');
  tok.owner = await login('owner@test.local', 'clave-1234');
  tok.guard = await login('guard@test.local', 'clave-1234');
  tok.supervisor = await login('sup@test.local', 'clave-1234');
});

test('complejos: el superadmin edita nombre y estado', async () => {
  await call('PUT', `/platform/tenants/${tenantId}`, { token: tok.sa, body: { name: 'Test CRUD editado' }, expect: 200 });
  assert.equal((await one('SELECT name FROM tenants WHERE id=?', [tenantId])).name, 'Test CRUD editado');
  await call('PUT', `/platform/tenants/${tenantId}`, { token: tok.admin, body: { name: 'x' }, expect: 403 });
  await call('DELETE', `/platform/tenants/${tenantId}`, { token: tok.admin, expect: 403 });
});

test('lotes: editar, 404, bloqueo por usuarios asignados y aislamiento entre complejos', async () => {
  await call('PUT', `/lots/${ids.lot2}`, { token: tok.admin, body: { code: 'A-2b', address: 'Calle 1' }, expect: 200 });
  assert.deepEqual(await one('SELECT code,address FROM lots WHERE id=?', [ids.lot2]), { code: 'A-2b', address: 'Calle 1' });
  await call('PUT', '/lots/999999999', { token: tok.admin, body: { code: 'Z' }, expect: 404 });
  await call('PUT', `/lots/${ids.lot2}`, { token: tok.admin, body: { campo_raro: 1 }, expect: 400 });
  const blocked = await call('DELETE', `/lots/${ids.lot}?force=1`, { token: tok.admin, expect: 409 });
  assert.equal(blocked.blocked, true);
  await call('DELETE', `/lots/${ids.lot}`, { token: tok.owner, expect: 403 });
  // Un admin de OTRO complejo no ve este lote
  const demo = await one("SELECT id FROM tenants WHERE slug NOT IN ('plataforma', ?) LIMIT 1", [SLUG]);
  if (demo) {
    const other = (await call('POST', `/platform/tenants/${demo.id}/enter`, { token: tok.sa, expect: 200 })).token;
    await call('PUT', `/lots/${ids.lot2}`, { token: other, body: { code: 'hack' }, expect: 404 });
    await call('DELETE', `/lots/${ids.lot2}`, { token: other, expect: 404 });
  }
  await call('DELETE', `/lots/${ids.lot2}`, { token: tok.admin, expect: 200 });
  assert.equal(await one('SELECT id FROM lots WHERE id=?', [ids.lot2]), undefined);
});

test('usuarios: editar datos, contraseña y rol; no auto-eliminarse', async () => {
  await call('PUT', `/users/${ids.owner}`, { token: tok.admin, body: { full_name: 'Owner Editado', phone: '1122', password: 'nueva-clave-99' }, expect: 200 });
  assert.equal((await one('SELECT full_name FROM users WHERE id=?', [ids.owner])).full_name, 'Owner Editado');
  tok.owner = await login('owner@test.local', 'nueva-clave-99');
  await call('PUT', `/users/${ids.supervisor}`, { token: tok.admin, body: { role: 'guard' }, expect: 200 });
  await call('PUT', `/users/${ids.supervisor}`, { token: tok.admin, body: { role: 'supervisor' }, expect: 200 });
  const me = await one("SELECT id FROM users WHERE email='admin@test.local' AND tenant_id=?", [tenantId]);
  await call('DELETE', `/users/${me.id}`, { token: tok.admin, expect: 400 });
  await call('PUT', `/users/${ids.guard}`, { token: tok.supervisor, body: { full_name: 'x' }, expect: 403 });
  const res = await call('PUT', `/users/${ids.guard}`, { token: tok.admin, body: { phone: '999' }, expect: 200 });
  assert.equal(res.password_hash, undefined, 'nunca devuelve el hash');
});

test('cambiar clave: solo admin, valida largo, queda auditado', async () => {
  await call('POST', `/users/${ids.guard}/password`, { token: tok.admin, body: { password: 'corta' }, expect: 400 });
  await call('POST', `/users/${ids.guard}/password`, { token: tok.supervisor, body: { password: 'otra-clave-123' }, expect: 403 });
  await call('POST', '/users/999999999/password', { token: tok.admin, body: { password: 'otra-clave-123' }, expect: 404 });
  await call('POST', `/users/${ids.guard}/password`, { token: tok.admin, body: { password: 'otra-clave-123' }, expect: 200 });
  tok.guard = await login('guard@test.local', 'otra-clave-123');
  await call('POST', '/auth/login', { body: { tenant: SLUG, email: 'guard@test.local', password: 'clave-1234' }, expect: 401 });
  assert.ok(await one("SELECT id FROM audit_log WHERE entity='user' AND entity_id=? AND action='password_reset'", [ids.guard]));
});

test('familia: el propietario edita, no elimina; el admin elimina', async () => {
  ids.family = (await call('POST', '/household', { token: tok.owner, expect: 201,
    body: { role: 'family', email: 'fam@test.local', password: 'clave-1234', full_name: 'Familiar' } })).id;
  await call('PUT', `/household/${ids.family}`, { token: tok.owner, body: { full_name: 'Familiar Editado', role: 'resident' }, expect: 200 });
  assert.equal((await one('SELECT full_name FROM users WHERE id=?', [ids.family])).full_name, 'Familiar Editado');
  await call('PUT', `/household/${ids.guard}`, { token: tok.owner, body: { full_name: 'Intento ajeno' }, expect: 404 });
  await call('DELETE', `/users/${ids.family}`, { token: tok.owner, expect: 403 });
  await call('DELETE', `/users/${ids.family}`, { token: tok.admin, expect: 200 });
  assert.equal(await one('SELECT id FROM users WHERE id=?', [ids.family]), undefined);
  assert.equal(await one('SELECT user_id FROM user_roles WHERE user_id=?', [ids.family]), undefined);
});

test('visitas: la guardia no edita ni borra; supervisor edita, solo admin elimina', async () => {
  const v = await call('POST', '/visits/request', { token: tok.guard, expect: 201, body: { lot_id: ids.lot, visitor_name: 'Juan', visitor_dni: '30.123.456' } });
  assert.equal(v.visitor_dni, '30123456', 'el DNI se guarda sin puntos');
  await call('PUT', `/visits/${v.id}`, { token: tok.guard, body: { visitor_name: 'Juan Pérez' }, expect: 403 });
  await call('PUT', `/visits/${v.id}`, { token: tok.supervisor, body: { visitor_name: 'Juan Pérez', vehicle_plate: 'AB123CD' }, expect: 200 });
  assert.equal((await one('SELECT visitor_name FROM visits WHERE id=?', [v.id])).visitor_name, 'Juan Pérez');
  await call('DELETE', `/visits/${v.id}`, { token: tok.guard, expect: 403 });
  await call('DELETE', `/visits/${v.id}`, { token: tok.admin, expect: 200 });
  assert.equal(await one('SELECT id FROM visits WHERE id=?', [v.id]), undefined);
});

test('control de accesos: invitación QR de punta a punta (validar, ingresar, reutilizar, cancelar, vencida)', async () => {
  const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const now = Date.now();
  const range = { valid_from: local(new Date(now - 3600e3)), valid_until: local(new Date(now + 3600e3)) };
  // El propietario debe cargar el DNI
  await call('POST', '/visits/qr', { token: tok.owner, body: { visitor_name: 'Ana Gómez', ...range }, expect: 400 });
  const inv = await call('POST', '/visits/qr', { token: tok.owner, body: { visitor_name: 'Ana Gómez', visitor_dni: '28123456', notes: 'Trae torta', ...range }, expect: 201 });
  assert.match(inv.qr_token, /^[a-f0-9]{32}$/, 'el QR solo contiene un token aleatorio');

  // Guardia: tokens manipulados o inexistentes; otros roles no validan
  await call('GET', '/visits/invitation/manipulado', { token: tok.guard, expect: 400 });
  await call('GET', `/visits/invitation/${'0'.repeat(32)}`, { token: tok.guard, expect: 404 });
  await call('GET', `/visits/invitation/${inv.qr_token}`, { token: tok.owner, expect: 403 });

  // Validación: datos completos para la tarjeta
  const val = await call('GET', `/visits/invitation/${inv.qr_token}`, { token: tok.guard, expect: 200 });
  assert.equal(val.state, 'pending');
  assert.equal(val.can_enter, true);
  assert.equal(val.invitation.visitor_dni, '28123456');
  assert.equal(val.invitation.lot_code, 'A-1');
  assert.equal(val.invitation.notes, 'Trae torta');
  assert.match(val.invitation.family || '', /Owner Editado/);

  // Confirmar ingreso: guarda método, guardia y hora; un segundo ingreso es imposible
  const entered = await call('POST', `/visits/${inv.id}/entry`, { token: tok.guard, expect: 200 });
  assert.equal(entered.status, 'inside');
  assert.equal(entered.entry_method, 'invitation_qr');
  assert.equal(entered.entry_guard_id, ids.guard);
  const twice = await call('POST', `/visits/${inv.id}/entry`, { token: tok.guard, expect: 409 });
  assert.match(twice.error, /^Esta invitación ya fue utilizada el \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  const rescan = await call('GET', `/visits/invitation/${inv.qr_token}`, { token: tok.guard, expect: 200 });
  assert.equal(rescan.state, 'used');
  assert.equal(rescan.can_enter, false);
  assert.equal(rescan.message, twice.error);
  // Auditoría: escaneo, ingreso, intento repetido y nuevo escaneo
  const acts = (await query("SELECT action FROM audit_log WHERE entity='visit' AND entity_id=? ORDER BY id", [inv.id])).map((a) => a.action);
  assert.deepEqual(acts.filter((a) => a !== 'qr_created'), ['qr_scanned', 'entry', 'entry_denied', 'qr_scanned']);

  // Cancelada por el propietario
  const c = await call('POST', '/visits/qr', { token: tok.owner, body: { visitor_name: 'Leo Paz', visitor_dni: '35111222', ...range }, expect: 201 });
  await call('POST', `/visits/${c.id}/cancel`, { token: tok.owner, expect: 200 });
  const cv = await call('GET', `/visits/invitation/${c.qr_token}`, { token: tok.guard, expect: 200 });
  assert.equal(cv.state, 'cancelled');
  await call('POST', `/visits/${c.id}/entry`, { token: tok.guard, expect: 409 });

  // Vencida: queda marcada al escanearla
  const e = await call('POST', '/visits/qr', { token: tok.owner, body: { visitor_name: 'Eva Ruiz', visitor_dni: '36111222', ...range }, expect: 201 });
  await query('UPDATE visits SET valid_until = NOW() - INTERVAL 1 MINUTE WHERE id=?', [e.id]);
  const ev = await call('GET', `/visits/invitation/${e.qr_token}`, { token: tok.guard, expect: 200 });
  assert.equal(ev.state, 'expired');
  assert.equal((await one('SELECT status FROM visits WHERE id=?', [e.id])).status, 'expired');
  await call('POST', `/visits/${e.id}/entry`, { token: tok.guard, expect: 409 });
});

test('control de accesos: ingreso con DNI, rechazo, movimientos filtrados en el servidor y buscador de lotes', async () => {
  // DNI manual: ingreso directo y rechazo de un visitante sin invitación
  const w = await call('POST', '/visits/walk-in', { token: tok.guard, body: { lot_id: ids.lot, visitor_name: 'PÉREZ JUAN', visitor_dni: '32123456', type: 'delivery' }, expect: 201 });
  assert.equal(w.status, 'inside');
  assert.equal(w.entry_method, 'dni_manual');
  await call('POST', '/visits/walk-in', { token: tok.guard, body: { lot_id: ids.lot, visitor_name: 'Juan', visitor_dni: 'abc' }, expect: 400 });
  await call('POST', '/visits/walk-in', { token: tok.owner, body: { lot_id: ids.lot, visitor_name: 'Juan', visitor_dni: '32123456' }, expect: 403 });
  const rj = await call('POST', '/visits/reject', { token: tok.guard, body: { lot_id: ids.lot, visitor_name: 'SOSA RAÚL', visitor_dni: '33123456', reason: 'No figura en la lista' }, expect: 200 });
  assert.equal(rj.status, 'rejected');
  assert.equal(rj.rejected_by, ids.guard);
  await call('POST', `/visits/${w.id}/exit`, { token: tok.guard, expect: 200 });

  // Movimientos: últimos 5, filtrados por el backend, con familia
  const all = await call('GET', '/visits?movement=all&limit=5', { token: tok.guard, expect: 200 });
  assert.ok(all.items.length <= 5);
  // El egreso y el rechazo ocurren en el mismo segundo: ambos encabezan la lista (desempate por id)
  assert.deepEqual(all.items.slice(0, 2).map((m) => m.id).sort(), [w.id, rj.id].sort());
  assert.match(all.items.find((m) => m.id === w.id).family || '', /Owner Editado/);
  const out = await call('GET', '/visits?movement=exited', { token: tok.guard, expect: 200 });
  assert.ok(out.items.every((m) => m.status === 'exited') && out.items.some((m) => m.id === w.id));
  const rej = await call('GET', '/visits?movement=rejected', { token: tok.guard, expect: 200 });
  assert.ok(rej.items.every((m) => m.status === 'rejected') && rej.items.some((m) => m.id === rj.id));
  await call('GET', '/visits?movement=todo', { token: tok.guard, expect: 400 });
  const p2 = await call('GET', '/visits?movement=all&limit=1&offset=1', { token: tok.guard, expect: 200 });
  assert.equal(p2.items[0]?.id, all.items[1].id, 'paginación');

  // Buscador de lote: por número y por apellido del grupo familiar
  const byCode = await call('GET', '/lots/search?q=A-1', { token: tok.guard, expect: 200 });
  assert.equal(byCode.items[0].code, 'A-1');
  const byName = await call('GET', `/lots/search?q=${encodeURIComponent('Familia Editado')}`, { token: tok.guard, expect: 200 });
  assert.deepEqual(byName.items.map((l) => l.code), ['A-1']);
  assert.equal(byName.items[0].holder, 'Owner Editado');
  await call('GET', '/lots/search?q=A', { token: tok.owner, expect: 403 });
});

test('rondas y puntos: dependencias, cascada con force y permisos', async () => {
  ids.cp = (await call('POST', '/checkpoints', { token: tok.supervisor, body: { name: 'Portón', tag_code: 'TAG-0001' }, expect: 201 })).id;
  const round = await call('POST', '/rounds/start', { token: tok.guard, body: {}, expect: 201 });
  await call('PUT', `/checkpoints/${ids.cp}`, { token: tok.supervisor, body: { name: 'Portón norte' }, expect: 200 });
  await call('DELETE', `/checkpoints/${ids.cp}`, { token: tok.supervisor, expect: 403 });
  const deps = await call('DELETE', `/checkpoints/${ids.cp}`, { token: tok.admin, expect: 409 });
  assert.equal(deps.requiresForce, true);
  assert.equal(deps.dependencies[0].count, 1);
  await call('DELETE', `/checkpoints/${ids.cp}?force=1`, { token: tok.admin, expect: 200 });
  assert.equal(await one('SELECT id FROM round_points WHERE checkpoint_id=?', [ids.cp]), undefined);
  await call('PUT', `/rounds/${round.id}`, { token: tok.supervisor, body: { status: 'incomplete', expected_minutes: 30 }, expect: 200 });
  await call('DELETE', `/rounds/${round.id}`, { token: tok.admin, expect: 200 });
  assert.equal(await one('SELECT id FROM rounds WHERE id=?', [round.id]), undefined);
});

test('expensas: edición restringida si hay pago, borrar pago recalcula estado, cascada', async () => {
  const s = await query("INSERT INTO expense_settlements (tenant_id,lot_id,period,amount,due_date) VALUES (?,?,'2026-01',1000,'2026-01-10')", [tenantId, ids.lot]);
  ids.settlement = s.insertId;
  await call('PUT', `/expenses/${ids.settlement}`, { token: tok.admin, body: { amount: 1500, detail: 'Ajuste' }, expect: 200 });
  await call('PUT', `/expenses/${ids.settlement}`, { token: tok.owner, body: { amount: 1 }, expect: 403 });
  await call('POST', `/expenses/${ids.settlement}/cash`, { token: tok.admin, body: { amount: 1500 }, expect: 201 });
  await call('PUT', `/expenses/${ids.settlement}`, { token: tok.admin, body: { amount: 2000 }, expect: 409 });
  await call('PUT', `/expenses/${ids.settlement}`, { token: tok.admin, body: { due_date: '2026-01-20' }, expect: 200 });
  const pay = await one('SELECT id FROM expense_payments WHERE settlement_id=?', [ids.settlement]);
  await call('PUT', `/expenses/payments/${pay.id}`, { token: tok.admin, body: { receipt_number: 'R-TEST' }, expect: 200 });
  await call('DELETE', `/expenses/payments/${pay.id}`, { token: tok.admin, expect: 200 });
  assert.equal((await one('SELECT status FROM expense_settlements WHERE id=?', [ids.settlement])).status, 'pending');
  await call('POST', `/expenses/${ids.settlement}/cash`, { token: tok.admin, body: { amount: 1500 }, expect: 201 });
  await call('DELETE', `/expenses/${ids.settlement}`, { token: tok.admin, expect: 409 });
  await call('DELETE', `/expenses/${ids.settlement}?force=1`, { token: tok.admin, expect: 200 });
  assert.equal(await one('SELECT id FROM expense_payments WHERE settlement_id=?', [ids.settlement]), undefined);
});

test('espacios y reservas: editar, validar horario y cascada', async () => {
  ids.space = (await call('POST', '/spaces', { token: tok.admin, expect: 201,
    body: { name: 'Cancha 1', type: 'court', open_time: '00:00', close_time: '23:59', min_advance_hours: 0, requires_approval: true } })).id;
  await call('PUT', `/spaces/${ids.space}`, { token: tok.admin, body: { name: 'Cancha central', capacity: 2 }, expect: 200 });
  await call('PUT', `/spaces/${ids.space}`, { token: tok.admin, body: { open_time: '23:00', close_time: '08:00' }, expect: 400 });
  const d = new Date(Date.now() + 26 * 3600000);
  const start = `${d.toISOString().slice(0, 10)} 10:00:00`;
  const res = await call('POST', '/reservations', { token: tok.owner, body: { space_id: ids.space, start_at: start }, expect: 201 });
  await call('PUT', `/reservations/${res.id}`, { token: tok.admin, body: { status: 'approved', review_note: 'ok' }, expect: 200 });
  await call('PUT', `/reservations/${res.id}`, { token: tok.owner, body: { status: 'approved' }, expect: 403 });
  await call('DELETE', `/spaces/${ids.space}`, { token: tok.admin, expect: 409 });
  await call('DELETE', `/spaces/${ids.space}?force=1`, { token: tok.admin, expect: 200 });
  assert.equal(await one('SELECT id FROM reservations WHERE id=?', [res.id]), undefined);
});

test('incidentes: staff edita, solo admin elimina', async () => {
  const inc = await call('POST', '/incidents', { token: tok.owner, body: { type: 'medical' }, expect: 201 });
  await call('PUT', `/incidents/${inc.id}`, { token: tok.guard, body: { status: 'resolved', resolution: 'Atendido' }, expect: 200 });
  await call('PUT', `/incidents/${inc.id}`, { token: tok.owner, body: { status: 'open' }, expect: 403 });
  await call('DELETE', `/incidents/${inc.id}`, { token: tok.owner, expect: 403 });
  await call('DELETE', `/incidents/${inc.id}`, { token: tok.admin, expect: 200 });
  assert.equal(await one('SELECT id FROM incidents WHERE id=?', [inc.id]), undefined);
});

test('auditoría: cada edición y eliminación queda registrada', async () => {
  const rows = await query("SELECT action, COUNT(*) n FROM audit_log WHERE tenant_id=? AND action IN ('update','delete') GROUP BY action", [tenantId]);
  const by = Object.fromEntries(rows.map((r) => [r.action, Number(r.n)]));
  assert.ok(by.update >= 10, `updates auditados: ${by.update}`);
  assert.ok(by.delete >= 8, `deletes auditados: ${by.delete}`);
});

test('branding: identidad, archivos, galería y página pública', async () => {
  const png = await sharp({ create: { width: 800, height: 500, channels: 3, background: '#0f766e' } }).png().toBuffer();
  const up = async (token, kind, extra = {}, file = png, type = 'image/png') => {
    const fd = new FormData();
    fd.append('kind', kind);
    for (const [k, v] of Object.entries(extra)) { fd.append(k, v); }
    fd.append('file', new Blob([file], { type }), 'foto.png');
    const r = await fetch(`${B}/branding/assets`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    return { status: r.status, data: await r.json() };
  };
  // Solo admin
  assert.equal((await up(tok.owner, 'logo')).status, 403);
  await call('PUT', '/branding', { token: tok.guard, body: { tagline: 'x' }, expect: 403 });
  // Datos y validaciones
  await call('PUT', '/branding', { token: tok.admin, body: { primary_color: 'rojo' }, expect: 400 });
  await call('PUT', '/branding', { token: tok.admin, body: { font_display: 'Comic Sans' }, expect: 400 });
  await call('PUT', '/branding', { token: tok.admin, body: { video_url: 'http://inseguro.com/v' }, expect: 400 });
  const themes = (await call('GET', '/public/themes', { expect: 200 })).themes;
  const b = await call('PUT', '/branding', { token: tok.admin, expect: 200,
    body: { theme_id: themes[1].id, display_name: 'Country Test', tagline: 'Vivir mejor', accent_color: '#ff0066', public_enabled: true } });
  assert.equal(b.settings.primary_color, themes[1].primary_color, 'hereda el color del tema');
  assert.equal(b.settings.accent_color, '#ff0066', 'el color propio pisa al del tema');
  // Logo: se convierte a WebP; reemplazarlo borra el archivo anterior
  const l1 = await up(tok.admin, 'logo');
  assert.equal(l1.status, 201);
  assert.match(l1.data.settings.logo_url, /.webp$/);
  const f1 = path.join(UPLOADS_ROOT, 'tenants', l1.data.settings.logo_url.replace('/uploads/tenants/', ''));
  assert.ok(fs.existsSync(f1));
  assert.equal((await up(tok.admin, 'logo')).status, 201);
  assert.ok(!fs.existsSync(f1), 'el logo anterior se borró del disco');
  // Tipos rechazados
  assert.equal((await up(tok.admin, 'cover', {}, Buffer.from('<svg><script>alert(1)</script></svg>'), 'image/svg+xml')).status, 400);
  assert.equal((await up(tok.admin, 'logo', {}, Buffer.from('<svg onload="x()"></svg>'), 'image/svg+xml')).status, 400);
  assert.equal((await up(tok.admin, 'video')).status, 400, 'una imagen no es un video');
  // Galería: alta, edición, orden, borrado
  const g1 = (await up(tok.admin, 'image', { category: 'amenities', title: 'Piscina' })).data.gallery;
  const g2 = (await up(tok.admin, 'image', { category: 'nada-valido' })).data.gallery;
  assert.equal(g2.length, 2);
  assert.equal(g2[1].category, 'premium', 'categoría inválida → premium');
  await call('PUT', `/branding/gallery/${g1[0].id}`, { token: tok.admin, body: { title: 'Piscina climatizada' }, expect: 200 });
  const re = await call('POST', '/branding/gallery/reorder', { token: tok.admin, body: { order: [g2[1].id, g2[0].id] }, expect: 200 });
  assert.equal(re.gallery[0].id, g2[1].id);
  // Página pública (sin token)
  const pub = await call('GET', `/public/tenants/${SLUG}`, { expect: 200 });
  assert.equal(pub.settings.display_name, 'Country Test');
  assert.equal(pub.gallery.length, 2);
  assert.equal(pub.settings.custom, undefined, 'no expone campos internos');
  const img = await fetch(`http://127.0.0.1:${PORT}${pub.gallery[0].url}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/webp');
  await call('DELETE', `/branding/gallery/${g1[0].id}`, { token: tok.admin, expect: 200 });
  assert.equal((await call('GET', `/public/tenants/${SLUG}`, { expect: 200 })).gallery.length, 1);
  // Lectura para cualquier usuario del complejo
  assert.equal((await call('GET', '/branding/current', { token: tok.owner, expect: 200 })).settings.display_name, 'Country Test');
  // Despublicar
  await call('PUT', '/branding', { token: tok.admin, body: { public_enabled: false }, expect: 200 });
  await call('GET', `/public/tenants/${SLUG}`, { expect: 404 });
  ids.brandingDir = path.join(UPLOADS_ROOT, 'tenants', String(tenantId));
  assert.ok(fs.existsSync(ids.brandingDir));
});

test('demo: pedido válido, honeypot y validación', async () => {
  await call('POST', '/public/demo-requests', { body: { name: 'Test CRUD', email: 'demo@test.local', kind: 'edificio', units: 40 }, expect: 201 });
  await call('POST', '/public/demo-requests', { body: { name: 'Bot', email: 'bot@test.local', website: 'spam' }, expect: 400 });
  await call('POST', '/public/demo-requests', { body: { name: 'X', email: 'no-es-email' }, expect: 400 });
  await query("DELETE FROM demo_requests WHERE email IN ('demo@test.local')");
});

// Imagen sintética de un DNI (datos ficticios) renderizada con SVG, con ruido y leve rotación como una foto
async function fakeDniPhoto(lines, { rotate = 0, w = 1400, h = 880, photo = true } = {}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" rx="40" fill="#e8eef3"/>
    ${lines.map(([t, size, y, x = 520, weight = 400]) => `<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" fill="#1f2937">${t}</text>`).join('')}
    ${photo ? '<rect x="60" y="230" width="380" height="480" rx="20" fill="#9ca3af"/>' : ''}</svg>`;
  return sharp(Buffer.from(svg)).rotate(rotate, { background: '#555' }).blur(0.6).modulate({ brightness: 0.95 }).jpeg({ quality: 85 }).toBuffer();
}
const FRENTE = [
  ['REPUBLICA ARGENTINA - MERCOSUR', 34, 90, 360, 700], ['REGISTRO NACIONAL DE LAS PERSONAS', 26, 140, 400],
  ['Apellido / Surname', 24, 260], ['PEREZ GOMEZ', 44, 312, 520, 700], ['Nombre / Name', 24, 380], ['JUAN CARLOS', 44, 432, 520, 700],
  ['Sexo / Sex     Nacionalidad / Nationality', 24, 500], ['M                ARGENTINA', 36, 548, 520, 700],
  ['Documento / Document', 24, 740], ['30.123.456', 52, 800, 520, 700],
];
const DORSO = [
  ['IDARG25123456&lt;5&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;', 46, 600, 80], ['7611025F2505108ARG&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;4', 46, 680, 80],
  ['FERNANDEZ&lt;&lt;MARIA&lt;LAURA&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;', 46, 760, 80],
];
const ocr = async (token, buf, type = 'image/jpeg', name = 'dni.jpg') => {
  const fd = new FormData();
  fd.append('image', new Blob([buf], { type }), name);
  const r = await fetch(`${B}/dni/ocr`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
  return { status: r.status, data: await r.json().catch(() => null) };
};

test('DNI OCR – Caso 3: foto del frente → completa Nombre y DNI', { timeout: 180000 }, async () => {
  const r = await ocr(tok.guard, await fakeDniPhoto(FRENTE, { rotate: 2 }));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.found, true);
  assert.equal(r.data.nombreCompleto, 'PEREZ GOMEZ JUAN CARLOS');
  assert.equal(r.data.dni, '30123456');
});

test('DNI OCR – Caso 3b: foto del dorso girada 90° → MRZ con rotación automática', { timeout: 180000 }, async () => {
  const r = await ocr(tok.supervisor, await fakeDniPhoto(DORSO, { rotate: 90, photo: false }));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.found, true);
  assert.equal(r.data.nombreCompleto, 'FERNANDEZ MARIA LAURA');
  assert.equal(r.data.dni, '25123456');
});

test('DNI OCR – Caso 4: imagen sin DNI → found=false (el guardia carga a mano)', { timeout: 180000 }, async () => {
  const r = await ocr(tok.admin, await fakeDniPhoto([['FACTURA B', 60, 300], ['TOTAL 1250', 60, 420]]));
  assert.equal(r.status, 200);
  assert.equal(r.data.found, false);
});

test('DNI OCR – seguridad: roles, formatos, contenido real y tamaño', async () => {
  const png = await sharp({ create: { width: 800, height: 500, channels: 3, background: '#fff' } }).png().toBuffer();
  assert.equal((await ocr(null, png, 'image/png')).status, 401);
  assert.equal((await ocr(tok.owner, png, 'image/png')).status, 403, 'un propietario no usa el lector');
  const gif = await sharp({ create: { width: 800, height: 500, channels: 3, background: '#fff' } }).gif().toBuffer();
  assert.equal((await ocr(tok.guard, gif, 'image/gif', 'x.gif')).status, 415, 'GIF no permitido');
  assert.equal((await ocr(tok.guard, Buffer.from('no soy una imagen'), 'image/jpeg')).status, 415, 'contenido falso con mimetype jpeg');
  assert.equal((await ocr(tok.guard, await sharp({ create: { width: 100, height: 80, channels: 3, background: '#fff' } }).jpeg().toBuffer())).status, 422, 'muy chica');
  const big = Buffer.alloc(9 * 1024 * 1024, 1);
  assert.equal((await ocr(tok.guard, big)).status, 413, 'supera 8 MB');
  // No deja archivos temporales
  assert.equal(fs.existsSync(path.join(UPLOADS_ROOT, 'tmp')), false);
});

test('DNI eventos del lector: registra sin datos personales y valida', async () => {
  await call('POST', '/dni/events', { token: tok.guard, body: { event: 'pdf417_ok', ms: 850, formato: 'nuevo' }, expect: 204 });
  await call('POST', '/dni/events', { token: tok.guard, body: { event: 'ocr_fallback' }, expect: 204 });
  await call('POST', '/dni/events', { token: tok.guard, body: { event: 'cualquier-cosa' }, expect: 400 });
  await call('POST', '/dni/events', { token: tok.guard, body: { event: 'manual', nombre: 'PEREZ' }, expect: 400 }); // no acepta datos extra
  await call('POST', '/dni/events', { token: tok.owner, body: { event: 'manual' }, expect: 403 });
});

// ===================== Módulo de expensas: gastos, liquidación, portal y MercadoPago =====================
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const form = async (method, pathname, token, fields = {}, file) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) { fd.append(k, String(v)); }
  if (file) { fd.append(file.field, new Blob([file.buffer], { type: file.type }), file.name); }
  const r = await fetch(B + pathname, { method, headers: { Authorization: `Bearer ${token}` }, body: fd });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const raw = async (pathname, token) => {
  const r = await fetch(B + pathname, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: r.status, type: r.headers.get('content-type') || '', body: Buffer.from(await r.arrayBuffer()) };
};
const fin = {};

test('expensas · rubros: sugeridos, sin duplicados, bloqueo si tienen gastos', async () => {
  const cats = await call('GET', '/expense-categories', { token: tok.admin, expect: 200 });
  assert.equal(cats.length, 12, 'el complejo nace con los 12 rubros sugeridos');
  fin.cat = cats.find((c) => c.name === 'Seguridad').id;
  fin.cat2 = cats.find((c) => c.name === 'Jardinería').id;
  await call('POST', '/expense-categories', { token: tok.admin, body: { name: 'seguridad' }, expect: 409 }); // sin importar mayúsculas
  fin.catNew = (await call('POST', '/expense-categories', { token: tok.admin, body: { name: 'Vigilancia nocturna' }, expect: 201 })).id;
  await call('PUT', `/expense-categories/${fin.catNew}`, { token: tok.admin, body: { name: 'Seguridad' }, expect: 409 });
  await call('GET', '/expense-categories', { token: tok.owner, expect: 403 });
});

test('expensas · proveedores: alta, CUIT válido y único', async () => {
  await call('POST', '/suppliers', { token: tok.admin, body: { legal_name: 'Malo SA', cuit: '123' }, expect: 400 });
  fin.sup = (await call('POST', '/suppliers', { token: tok.admin, body: { legal_name: 'Top Group Seguridad SRL', cuit: '30-71234567-8' }, expect: 201 })).id;
  await call('POST', '/suppliers', { token: tok.admin, body: { legal_name: 'Otro', cuit: '30712345678' }, expect: 409 });
  const list = await call('GET', '/suppliers?q=Top', { token: tok.admin, expect: 200 });
  assert.equal(list[0].cuit, '30712345678');
});

test('expensas · gastos: alta con comprobante privado, validaciones y acceso', async () => {
  const base = { date: '2026-03-12', category_id: fin.cat, supplier_id: fin.sup, concept: 'Servicio de vigilancia marzo', amount: '6087220', voucher_type: 'Factura A', voucher_number: 'FA 0002-00001234' };
  // Comprobantes inválidos
  assert.equal((await form('POST', '/expenditures', tok.admin, base, { field: 'voucher', buffer: Buffer.from('no soy pdf'), type: 'application/pdf', name: 'x.pdf' })).status, 415);
  assert.equal((await form('POST', '/expenditures', tok.admin, base, { field: 'voucher', buffer: Buffer.from('GIF89a'), type: 'image/gif', name: 'x.gif' })).status, 415);
  assert.equal((await form('POST', '/expenditures', tok.admin, { ...base, amount: '-5' })).status, 400);
  assert.equal((await form('POST', '/expenditures', tok.owner, base)).status, 403);
  // Válidos
  const g1 = await form('POST', '/expenditures', tok.admin, base, { field: 'voucher', buffer: PDF, type: 'application/pdf', name: 'fa.pdf' });
  assert.equal(g1.status, 201, JSON.stringify(g1.data));
  fin.exp1 = g1.data.id;
  fin.exp2 = (await form('POST', '/expenditures', tok.admin, { date: '2026-03-20', category_id: fin.cat2, concept: 'Corte de pasto', amount: '2000000.50' })).data.id;
  fin.exp3 = (await form('POST', '/expenditures', tok.admin, { date: '2026-03-25', category_id: fin.cat2, concept: 'Poda', amount: '412779.50' })).data.id;
  const list = await call('GET', '/expenditures?period=2026-03&limit=2&page=1', { token: tok.admin, expect: 200 });
  assert.equal(list.total, 3);
  assert.equal(list.rows.length, 2, 'paginado');
  assert.equal(list.amount, 8500000);
  // El archivo es privado: no se sirve estático y solo baja con permisos
  const [asset] = await query('SELECT a.path FROM expenditures e JOIN tenant_assets a ON a.id=e.asset_id WHERE e.id=?', [fin.exp1]);
  assert.ok(asset, 'el comprobante quedó en tenant_assets');
  fin.voucherFile = path.join(UPLOADS_ROOT, 'private', asset.path);
  assert.ok(fs.existsSync(fin.voucherFile));
  for (const p of [`/uploads/private/${asset.path}`, `/uploads/tenants/${asset.path}`]) {
    const r = await fetch(`http://127.0.0.1:${PORT}${p}`);
    assert.notEqual(r.status, 200, `no se sirve en ${p}`);
  }
  const v = await raw(`/expenditures/${fin.exp1}/voucher`, tok.owner);
  assert.equal(v.status, 200);
  assert.equal(v.type, 'application/pdf');
  assert.equal(v.body.subarray(0, 5).toString(), '%PDF-');
  assert.equal((await raw(`/expenditures/${fin.exp1}/voucher`, tok.guard)).status, 403, 'la guardia no ve comprobantes');
  assert.equal((await raw(`/expenditures/${fin.exp1}/voucher`)).status, 401);
  // Rubro con gastos: no se borra
  await call('DELETE', `/expense-categories/${fin.cat}?force=1`, { token: tok.admin, expect: 409 });
});

test('expensas · transparencia: resumen por rubro con porcentajes, sin datos internos', async () => {
  const s = await call('GET', '/expenditures/summary?period=2026-03', { token: tok.owner, expect: 200 });
  assert.equal(s.total, 8500000);
  assert.deepEqual(s.categories.map((c) => [c.name, c.total, c.pct]), [['Seguridad', 6087220, 71.6], ['Jardinería', 2412780, 28.4]]);
  const it = s.categories[0].items[0];
  assert.equal(it.supplier, 'Top Group Seguridad SRL');
  assert.equal(it.voucher, 'Factura A FA 0002-00001234');
  assert.equal(it.has_voucher, true);
  assert.equal(it.notes, undefined, 'no expone notas internas');
  assert.ok((await call('GET', '/expenditures/periods', { token: tok.owner, expect: 200 })).includes('2026-03'));
  await call('GET', '/expenditures/summary', { token: tok.guard, expect: 403 });
});

test('expensas · edición y borrado de gastos (auditados, borra el archivo)', async () => {
  const upd = await call('PUT', `/expenditures/${fin.exp3}`, { token: tok.admin, body: { date: '2026-04-02', amount: 500000 }, expect: 200 });
  assert.equal(upd.period, '2026-04', 'el período sigue a la fecha');
  await call('PUT', `/expenditures/${fin.exp3}`, { token: tok.admin, body: { category_id: 999999 }, expect: 400 });
  await call('PUT', `/expenditures/${fin.exp3}`, { token: tok.admin, body: { date: '2026-03-25', amount: 412779.5 }, expect: 200 });
  // Un gasto con comprobante, eliminado: se va el archivo
  const tmp = (await form('POST', '/expenditures', tok.admin, { date: '2026-02-01', category_id: fin.cat, concept: 'Temporal', amount: '10' }, { field: 'voucher', buffer: PDF, type: 'application/pdf', name: 't.pdf' })).data.id;
  const [a] = await query('SELECT a.path FROM expenditures e JOIN tenant_assets a ON a.id=e.asset_id WHERE e.id=?', [tmp]);
  await call('DELETE', `/expenditures/${tmp}`, { token: tok.admin, expect: 200 });
  assert.ok(!fs.existsSync(path.join(UPLOADS_ROOT, 'private', a.path)), 'archivo borrado');
  const acts = (await query("SELECT action FROM audit_log WHERE tenant_id=? AND entity='expenditure'", [tenantId])).map((x) => x.action);
  for (const act of ['create', 'update', 'delete']) { assert.ok(acts.includes(act), `auditado: ${act}`); }
});

test('expensas · varios lotes por propietario y familiares', async () => {
  fin.lotB = (await call('POST', '/lots', { token: tok.admin, body: { code: 'B-1' }, expect: 201 })).id;
  fin.lotC = (await call('POST', '/lots', { token: tok.admin, body: { code: 'C-1' }, expect: 201 })).id;
  fin.owner2 = (await call('POST', '/users', { token: tok.admin, expect: 201, body: { role: 'owner', email: 'owner2@test.local', password: 'clave-1234', full_name: 'Owner Dos', lot_id: fin.lotB } })).id;
  tok.owner2 = await login('owner2@test.local', 'clave-1234');
  // El propietario 1 suma el lote C-1
  const res = await call('PUT', `/users/${ids.owner}/lots`, { token: tok.admin, body: { lot_ids: [fin.lotC] }, expect: 200 });
  assert.deepEqual(res.lot_ids.sort(), [ids.lot, fin.lotC].sort(), 'el principal se mantiene');
  await call('PUT', `/users/${ids.owner}/lots`, { token: tok.admin, body: { lot_ids: [999999] }, expect: 400 });
  await call('PUT', `/users/${ids.guard}/lots`, { token: tok.admin, body: { lot_ids: [fin.lotC] }, expect: 404 });
  fin.family = (await call('POST', '/household', { token: tok.owner, expect: 201, body: { role: 'family', email: 'fam2@test.local', password: 'clave-1234', full_name: 'Familiar Dos' } })).id;
  tok.family = await login('fam2@test.local', 'clave-1234');
  // Bases de prorrateo
  for (const [id, m2] of [[ids.lot, 1000], [fin.lotB, 600], [fin.lotC, 400]]) {
    await call('PUT', `/lots/${id}`, { token: tok.admin, body: { surface_m2: m2, coefficient: m2 / 100, share_pct: m2 / 20 }, expect: 200 });
  }
});

test('expensas · generación: vista previa, emisión, conflicto y reemplazo de pendientes', async () => {
  const body = { period: '2026-03', due_date: '2026-04-10', method: 'surface' };
  const pv = await call('POST', '/expense-runs/preview', { token: tok.admin, body, expect: 200 });
  assert.equal(pv.total, 8500000, 'sin total: prorratea los gastos del período');
  assert.deepEqual(pv.rows.map((r) => [r.lot_code, r.amount]), [['A-1', 4250000], ['B-1', 2550000], ['C-1', 1700000]]);
  await call('POST', '/expense-runs/preview', { token: tok.admin, body: { ...body, method: 'percentage', period: '2030-01' }, expect: 422 }); // sin gastos ese período
  await call('POST', '/expense-runs/preview', { token: tok.owner, body, expect: 403 });
  const run = await call('POST', '/expense-runs', { token: tok.admin, body, expect: 201 });
  assert.equal(run.created, 3);
  await call('POST', '/expense-runs', { token: tok.admin, body, expect: 409 });
  // El propietario 2 paga por transferencia → su expensa queda "en revisión" y no se recalcula
  const [s2] = await query("SELECT id, amount FROM expense_settlements WHERE lot_id=? AND period='2026-03'", [fin.lotB]);
  const tr = await form('POST', `/expenses/${s2.id}/transfer`, tok.owner2, { amount: s2.amount }, { field: 'receipt', buffer: PDF, type: 'application/pdf', name: 'c.pdf' });
  assert.equal(tr.status, 201, JSON.stringify(tr.data));
  const again = await call('POST', '/expense-runs', { token: tok.admin, body: { ...body, method: 'fixed', params: { amount: 1000 }, replace_pending: true }, expect: 201 });
  assert.deepEqual([again.created, again.updated, again.skipped], [0, 2, 1]);
  const after = await query("SELECT l.code, s.amount, s.status, s.run_id IS NOT NULL has_run FROM expense_settlements s JOIN lots l ON l.id=s.lot_id WHERE s.tenant_id=? AND s.period='2026-03' ORDER BY l.code", [tenantId]);
  assert.deepEqual(after.map((x) => [x.code, Number(x.amount), x.status]), [['A-1', 1000, 'pending'], ['B-1', 2550000, 'in_review'], ['C-1', 1000, 'pending']]);
  assert.ok(await one("SELECT id FROM audit_log WHERE tenant_id=? AND entity='expense_run' AND action='generate'", [tenantId]));
});

test('expensas · portal: estado de cuenta e historiales solo de lotes propios', async () => {
  const sum = await call('GET', '/owner/summary', { token: tok.owner, expect: 200 });
  assert.deepEqual(sum.lots.map((l) => l.code).sort(), ['A-1', 'C-1']);
  assert.equal(sum.current.period, '2026-03');
  assert.equal(sum.total_to_pay, 2000);
  assert.equal(sum.status, 'overdue', 'vencimiento 2026-04-10 ya pasó');
  const fam = await call('GET', '/owner/summary', { token: tok.family, expect: 200 });
  assert.equal(fam.total_to_pay, 2000, 'el familiar ve los lotes del propietario');
  const s2 = await call('GET', '/owner/summary', { token: tok.owner2, expect: 200 });
  assert.deepEqual(s2.lots.map((l) => l.code), ['B-1']);
  assert.equal(s2.in_review, 2550000);
  const hist = await call('GET', '/owner/settlements', { token: tok.owner2, expect: 200 });
  assert.ok(hist.rows.every((x) => x.lot_code === 'B-1'), 'nunca ve lotes ajenos');
  assert.equal((await call('GET', '/owner/payments', { token: tok.owner2, expect: 200 })).rows[0].status, 'pending');
  assert.equal((await call('GET', '/owner/payments', { token: tok.owner, expect: 200 })).rows.length, 0);
  await call('GET', '/owner/summary', { token: tok.guard, expect: 403 });
  // Endpoints existentes respetan los lotes: /expenses y comprobantes
  const exp = await call('GET', '/expenses', { token: tok.owner, expect: 200 });
  assert.deepEqual([...new Set(exp.map((x) => x.lot_code))].sort(), ['A-1', 'C-1']);
  const [s1] = await query("SELECT id FROM expense_settlements WHERE lot_id=? AND period='2026-03'", [ids.lot]);
  await call('POST', `/expenses/${s1.id}/cash`, { token: tok.owner2, body: { amount: 1000 }, expect: 403 });
  assert.equal((await form('POST', `/expenses/${s1.id}/transfer`, tok.owner2, { amount: 1000 }, { field: 'receipt', buffer: PDF, type: 'application/pdf', name: 'c.pdf' })).status, 403, 'no paga lotes ajenos');
  assert.equal((await form('POST', `/expenses/${s1.id}/transfer`, tok.family, { amount: 1000 }, { field: 'receipt', buffer: PDF, type: 'application/pdf', name: 'c.pdf' })).status, 403, 'el familiar no paga');
  const [p2] = await query('SELECT p.id FROM expense_payments p JOIN expense_settlements s ON s.id=p.settlement_id WHERE s.lot_id=?', [fin.lotB]);
  assert.equal((await raw(`/expenses/payments/${p2.id}/receipt-file`, tok.owner)).status, 403, 'no ve comprobantes ajenos');
  assert.equal((await raw(`/expenses/payments/${p2.id}/receipt-file`, tok.owner2)).status, 200);
});

test('expensas · dashboard administrativo', async () => {
  const d = await call('GET', '/expense-dashboard?period=2026-03', { token: tok.admin, expect: 200 });
  assert.equal(d.emitted, 2552000);
  assert.equal(d.collected, 0);
  assert.equal(d.pending, 2552000);
  assert.equal(d.expenses, 8500000);
  assert.equal(d.lots, 3);
  assert.equal(d.owners, 2);
  assert.equal(d.overdue_lots, 3);
  assert.equal(d.delinquency_rate, 100);
  await call('GET', '/expense-dashboard', { token: tok.owner, expect: 403 });
});

test('expensas · reportes Excel y PDF', async () => {
  const x = await raw('/expense-reports/expenditures?period=2026-03&format=xlsx', tok.owner);
  assert.equal(x.status, 200);
  assert.equal(x.body.subarray(0, 2).toString(), 'PK', 'xlsx (zip)');
  const p = await raw('/expense-reports/expenditures?period=2026-03&format=pdf', tok.admin);
  assert.equal(p.type, 'application/pdf');
  assert.equal(p.body.subarray(0, 5).toString(), '%PDF-');
  assert.equal((await raw('/expense-reports/collections?period=2026-03&format=pdf', tok.admin)).status, 200);
  assert.equal((await raw('/expense-reports/collections?period=2026-03&format=xlsx', tok.owner)).status, 403, 'datos de todos los lotes: solo admin');
});

test('expensas · configuración del complejo y medios de pago', async () => {
  await call('PUT', '/expense-config', { token: tok.admin, body: { cuit: '30-1' }, expect: 400 });
  await call('PUT', '/expense-config', { token: tok.admin, body: { legal_name: 'Consorcio Test', cuit: '30-70000000-1', email: 'adm@test.local' }, expect: 200 });
  const cfg = await call('GET', '/expense-config', { token: tok.admin, expect: 200 });
  assert.equal(cfg.cuit, '30700000001');
  assert.equal(cfg.mp_linked, false);
  await call('POST', '/payment-methods', { token: tok.admin, body: { type: 'transfer', label: 'Banco', data: { cbu: '123' } }, expect: 400 });
  const pm = (await call('POST', '/payment-methods', { token: tok.admin, expect: 201,
    body: { type: 'transfer', label: 'Banco Nación', data: { alias: 'COUNTRY.TEST', cbu: '0110599520000001234567', holder: 'Consorcio Test' } } })).id;
  const modo = (await call('POST', '/payment-methods', { token: tok.admin, expect: 201, body: { type: 'modo', label: 'MODO', data: { url: 'https://modo.com.ar/pagar/x' } } })).id;
  await call('PUT', `/payment-methods/${modo}`, { token: tok.admin, body: { active: false }, expect: 200 });
  await call('PUT', `/payment-methods/${pm}`, { token: tok.admin, body: { data: { url: 'javascript:alert(1)' } }, expect: 400 });
  const owner = await call('GET', '/payment-methods', { token: tok.owner, expect: 200 });
  assert.deepEqual(owner.methods.map((m) => m.label), ['Banco Nación'], 'el propietario ve solo los activos');
  await call('POST', '/payment-methods', { token: tok.owner, body: { type: 'modo', label: 'x', data: {} }, expect: 403 });
  assert.ok(await one("SELECT id FROM audit_log WHERE tenant_id=? AND entity='payment_method' AND action='update'", [tenantId]));
});

test('expensas · MercadoPago: OAuth, preferencia y webhook automático idempotente', async () => {
  const st = await call('GET', '/pagos/oauth/status', { token: tok.admin, expect: 200 });
  assert.equal(st.linked, false);
  await query('UPDATE tenants SET mp_access_token=? WHERE id=?', ['TEST-token', tenantId]);
  const [s] = await query("SELECT id, amount FROM expense_settlements WHERE lot_id=? AND period='2026-03'", [fin.lotC]);
  const pref = await call('POST', `/pagos/expenses/${s.id}/preference`, { token: tok.owner, expect: 200 });
  assert.equal(pref.init_point, 'https://mp.test/checkout');
  assert.equal(mp.lastPreference.items[0].unit_price, 1000, 'por el total');
  assert.match(mp.lastPreference.external_reference, new RegExp(`^${tenantId}:exp:${s.id}:${ids.owner}$`));
  await call('POST', `/pagos/expenses/${s.id}/preference`, { token: tok.owner2, expect: 403 });
  await call('POST', `/pagos/expenses/${s.id}/preference`, { token: tok.family, expect: 403 });
  // Webhook: importe distinto → se ignora
  mp.payments['PAY-BAD'] = { id: 'PAY-BAD', status: 'approved', transaction_amount: 999, external_reference: mp.lastPreference.external_reference };
  await fetch(`${B}/pagos/webhook?tenant=${tenantId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'payment', data: { id: 'PAY-BAD' } }) });
  assert.equal((await one('SELECT status FROM expense_settlements WHERE id=?', [s.id])).status, 'pending');
  // Pago aprobado por el total → acreditado automáticamente, una sola vez
  mp.payments['PAY-1'] = { id: 'PAY-1', status: 'approved', transaction_amount: 1000, external_reference: mp.lastPreference.external_reference };
  for (let i = 0; i < 3; i++) {
    const w = await fetch(`${B}/pagos/webhook?tenant=${tenantId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'payment', data: { id: 'PAY-1' } }) });
    assert.equal(w.status, 200);
  }
  assert.equal((await one('SELECT status FROM expense_settlements WHERE id=?', [s.id])).status, 'paid');
  const pays = await query("SELECT method, status, receipt_number FROM expense_payments WHERE settlement_id=?", [s.id]);
  assert.equal(pays.length, 1, 'idempotente: el webhook repetido no duplica el pago');
  assert.equal(pays[0].method, 'mercadopago');
  assert.match(pays[0].receipt_number, /^R-\d{8}$/);
  assert.ok(await one("SELECT id FROM audit_log WHERE tenant_id=? AND action='mp_payment_registered'", [tenantId]));
  // Desvincular
  await call('DELETE', '/pagos/oauth', { token: tok.admin, expect: 200 });
  await call('POST', `/pagos/expenses/${s.id}/preference`, { token: tok.owner, expect: 409 }); // ya pagada
});

test('sin token: 401', async () => {
  await call('DELETE', `/lots/${ids.lot}`, { expect: 401 });
});

test('complejo: borrado definitivo en cascada deja la base limpia', async () => {
  const deps = await call('DELETE', `/platform/tenants/${tenantId}`, { token: tok.sa, expect: 409 });
  assert.ok(deps.dependencies.length > 0);
  await call('DELETE', `/platform/tenants/${tenantId}?force=1`, { token: tok.sa, expect: 200 });
  for (const t of ['tenants', 'lots', 'users', 'visits', 'rounds', 'checkpoints', 'expense_settlements', 'spaces', 'reservations', 'incidents', 'audit_log',
    'expenditures', 'suppliers', 'expense_categories', 'expense_runs', 'payment_methods', 'user_lots']) {
    const col = t === 'tenants' ? 'id' : 'tenant_id';
    assert.equal(Number((await one(`SELECT COUNT(*) n FROM ${t} WHERE ${col}=?`, [tenantId])).n), 0, `quedaron filas en ${t}`);
  }
  const log = await one("SELECT action FROM audit_log WHERE entity='tenant' AND entity_id=? AND action='delete'", [tenantId]);
  assert.ok(log, 'el borrado del complejo queda auditado en la plataforma');
  if (ids.brandingDir) { assert.ok(!fs.existsSync(ids.brandingDir), 'se borró la carpeta de branding'); }
  for (const t of ['tenant_settings', 'tenant_gallery', 'tenant_assets']) { assert.equal(Number((await one(`SELECT COUNT(*) n FROM ${t} WHERE tenant_id=?`, [tenantId])).n), 0, `quedaron filas en ${t}`); }
  tenantId = null;
});
