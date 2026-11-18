// Notificaciones: plantillas, preferencias, cola (reintentos, dedupe, dispositivos dados de baja),
// eventos de negocio y recordatorios. Usa un complejo temporal y un proveedor simulado (no envía pushes reales).
import '../src/lib/env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, pool } from '../src/lib/db.js';
import { toSql } from '../src/lib/helpers.js';
import { TEMPLATES, render } from '../src/notifications/templates.js';
import { defaultsFor, get as getPrefs, update as updatePrefs } from '../src/notifications/preferences.js';
import { describeAgent, register } from '../src/notifications/subscriptions.js';
import { buildPayload, checkReadToken, readToken } from '../src/notifications/dispatcher.js';
import { providers } from '../src/notifications/providers.js';
import { notify } from '../src/notifications/service.js';
import { handle } from '../src/notifications/events.js';
import { bucketFor, runReminders } from '../src/notifications/scheduler.js';
import { drainNow } from '../src/notifications/queue.js';

const T = {};
const sent = []; // envíos del proveedor simulado
let mode = 'ok'; // ok | gone | retry
const realWebpush = { ...providers.webpush };

const roleId = async (name) => (await query('SELECT id FROM roles WHERE name=?', [name]))[0].id;
async function user(email, role, lotId = null, parent = null) {
  const x = await query('INSERT INTO users (tenant_id,email,password_hash,full_name,lot_id,parent_user_id) VALUES (?,?,?,?,?,?)',
    [T.tenant, `${email}-${Date.now()}@test.local`, 'x', email, lotId, parent]);
  await query('INSERT INTO user_roles (user_id, role_id) VALUES (?,?)', [x.insertId, await roleId(role)]);
  return { id: x.insertId, roles: [role] };
}
const rows = (userId) => query('SELECT * FROM notifications WHERE user_id=? ORDER BY id', [userId]);

before(async () => {
  T.tenant = (await query('INSERT INTO tenants (name, slug) VALUES (?,?)', ['Test notif', `test-notif-${Date.now()}`])).insertId;
  T.lot = (await query('INSERT INTO lots (tenant_id, code) VALUES (?,?)', [T.tenant, 'N-1'])).insertId;
  T.owner = await user('owner', 'owner', T.lot);
  T.family = await user('family', 'family', T.lot, T.owner.id);
  T.guard = await user('guard', 'guard');
  T.admin = await user('admin', 'admin');
  await query('INSERT INTO user_lots (user_id, lot_id, tenant_id) VALUES (?,?,?)', [T.owner.id, T.lot, T.tenant]);
  // Proveedor simulado (Web Push)
  Object.assign(providers.webpush, {
    enabled: true,
    send: async (device, msg) => {
      sent.push({ device: device.id, payload: msg.payload, priority: msg.priority });
      return mode === 'ok' ? { ok: true } : mode === 'gone' ? { gone: true } : { retry: true, error: 'webpush 503' };
    },
  });
});

after(async () => {
  Object.assign(providers.webpush, realWebpush);
  for (const t of ['notifications', 'notification_preferences', 'push_subscriptions', 'visits', 'expense_settlements', 'reservations', 'spaces', 'user_lots']) {
    await query(`DELETE FROM ${t} WHERE tenant_id=?`, [T.tenant]);
  }
  await query('DELETE FROM users WHERE tenant_id=?', [T.tenant]);
  await query('DELETE FROM lots WHERE tenant_id=?', [T.tenant]);
  await query('DELETE FROM tenants WHERE id=?', [T.tenant]);
  await pool.end();
});

test('todas las plantillas generan título, mensaje y deep link', () => {
  for (const type of Object.keys(TEMPLATES)) {
    const n = render(type, { visitor_name: 'Ana', vehicle_plate: 'AB123CD', days: 3, hours: 2, message: 'x', title: 'Corte de agua' });
    assert.ok(n.title && n.body && n.actionUrl.startsWith('/'), type);
  }
  assert.equal(render('access.vehicle_entered', { vehicle_plate: 'AB123CD' }).body, 'El vehículo autorizado AB123CD ingresó al complejo.');
  assert.equal(render('access.rejected', {}).priority, 'high');
  assert.equal(render('expenses.due_soon', { days: 0 }).body, 'Sus expensas vencen hoy.');
  assert.throws(() => render('no.existe'));
});

test('tramos de recordatorio', () => {
  assert.equal(bucketFor(6.5, [7, 3, 1]), 7);
  assert.equal(bucketFor(2, [7, 3, 1]), 3);
  assert.equal(bucketFor(0.5, [7, 3, 1]), 1);
  assert.equal(bucketFor(10, [7, 3, 1]), null);
  assert.equal(bucketFor(2, []), null);
});

test('User-Agent → plataforma, navegador y dispositivo', () => {
  assert.deepEqual(describeAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'),
    { platform: 'ios', browser: 'Safari', device: 'iPhone' });
  assert.deepEqual(describeAgent('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'),
    { platform: 'android', browser: 'Chrome', device: 'SM-S918B' });
  assert.equal(describeAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0').browser, 'Edge');
});

test('firma de lectura del service worker', () => {
  assert.ok(checkReadToken(42, readToken(42)));
  assert.ok(!checkReadToken(43, readToken(42)));
  assert.ok(!checkReadToken(42, 'falsa'));
  const p = buildPayload({ id: 7, tenant_id: 1, type: 'x', title: 't', body: 'b', action_url: '/expensas', priority: 'high', entity_type: 'settlement', entity_id: 9 });
  assert.equal(p.url, '/expensas');
  assert.equal(p.urgent, true);
  assert.equal(p.badge, '/badge-72.png');
  assert.equal(p.tag, 'x:9');
});

test('preferencias: defaults por rol, emergencias bloqueadas para el personal, valores inválidos ignorados', async () => {
  assert.equal(defaultsFor(['owner']).categories.security, false);
  assert.equal(defaultsFor(['guard']).categories.security, true);
  const g = await updatePrefs(T.guard, T.tenant, { categories: { emergencies: false, reservations: false } });
  assert.equal(g.categories.emergencies, true, 'no se puede silenciar');
  assert.equal(g.categories.reservations, false);
  const o = await updatePrefs(T.owner, T.tenant, { categories: { inventada: true }, reminders: { expense_due_days: [7, 5, 1] } });
  assert.deepEqual(o.reminders.expense_due_days, [7, 1], 'solo opciones válidas');
  assert.equal('inventada' in o.categories, false);
  assert.deepEqual((await getPrefs(T.owner)).reminders.expense_due_days, [7, 1]);
});

test('varios dispositivos por usuario; dedupe evita duplicados', async () => {
  await register({ tenantId: T.tenant, userId: T.owner.id, userAgent: 'iPhone Safari/1' }, { endpoint: `https://push.test/${Date.now()}-a`, keys: { p256dh: 'k', auth: 'a' } });
  await register({ tenantId: T.tenant, userId: T.owner.id, userAgent: 'Android 14; Pixel 8) Chrome/1' }, { endpoint: `https://push.test/${Date.now()}-b`, keys: { p256dh: 'k', auth: 'a' } });
  assert.equal(await notify(T.tenant, [T.owner.id], 'expenses.published', {}, { entityId: 1, dedupe: 'run-1' }), 1);
  assert.equal(await notify(T.tenant, [T.owner.id], 'expenses.published', {}, { entityId: 1, dedupe: 'run-1' }), 0, 'duplicado');
  sent.length = 0;
  await drainNow();
  const [n] = await rows(T.owner.id);
  assert.equal(n.status, 'sent');
  assert.equal(n.device_count, 2);
  assert.equal(n.delivered_count, 2);
  assert.equal(sent.length, 2, 'un envío por dispositivo');
  assert.equal(sent[0].payload.url, '/expensas');
});

test('caída temporal → reintento solo en los dispositivos faltantes', async () => {
  mode = 'retry';
  await notify(T.tenant, [T.owner.id], 'expenses.overdue', {}, { entityId: 2, dedupe: 'over-2' });
  await drainNow();
  let n = (await rows(T.owner.id)).at(-1);
  assert.equal(n.status, 'queued');
  assert.equal(n.attempts, 1);
  assert.match(n.last_error, /503/);
  // Vuelve el servicio: se adelanta el reintento
  mode = 'ok';
  sent.length = 0;
  await query('UPDATE notifications SET next_attempt_at=NOW() WHERE id=?', [n.id]);
  await drainNow();
  n = (await rows(T.owner.id)).at(-1);
  assert.equal(n.status, 'sent');
  assert.equal(n.attempts, 2);
  assert.equal(sent.length, 2);
});

test('dispositivo dado de baja (410) se elimina', async () => {
  mode = 'gone';
  await notify(T.tenant, [T.owner.id], 'system.test', {}, { force: true });
  await drainNow();
  mode = 'ok';
  const n = (await rows(T.owner.id)).at(-1);
  assert.equal(n.status, 'no_devices');
  assert.equal((await query('SELECT COUNT(*) c FROM push_subscriptions WHERE user_id=?', [T.owner.id]))[0].c, 0);
});

test('preferencia desactivada → no se crea la notificación', async () => {
  await updatePrefs(T.family, T.tenant, { categories: { access: false } });
  const before = (await rows(T.family.id)).length;
  await notify(T.tenant, [T.family.id], 'access.guest_entered', { visitor_name: 'Ana' });
  assert.equal((await rows(T.family.id)).length, before);
  await updatePrefs(T.family, T.tenant, { categories: { access: true } });
});

test('evento visit.entered (QR): quien invitó recibe "utilizada"; el resto de la unidad, el ingreso del vehículo', async () => {
  const x = await query(
    "INSERT INTO visits (tenant_id,lot_id,visitor_name,vehicle_plate,status,auth_method,created_by) VALUES (?,?,?,?,'inside','qr',?)",
    [T.tenant, T.lot, 'Ana', 'AB123CD', T.owner.id]);
  const [visit] = await query('SELECT * FROM visits WHERE id=?', [x.insertId]);
  await handle('visit.entered', { tenantId: T.tenant, visit, actorId: T.guard.id });
  await handle('visit.entered', { tenantId: T.tenant, visit, actorId: T.guard.id }); // evento repetido
  const o = (await rows(T.owner.id)).filter((n) => n.entity_id === visit.id);
  const f = (await rows(T.family.id)).filter((n) => n.entity_id === visit.id);
  assert.deepEqual(o.map((n) => n.type), ['visits.used']);
  assert.deepEqual(f.map((n) => n.type), ['access.vehicle_entered']);
  assert.equal(f[0].body, 'El vehículo autorizado AB123CD ingresó al complejo.');
});

test('evento visit.decided (rechazo): unidad y administración, prioridad alta', async () => {
  const x = await query(
    "INSERT INTO visits (tenant_id,lot_id,visitor_name,status,auth_method,created_by) VALUES (?,?,?,'rejected','realtime',?)",
    [T.tenant, T.lot, 'Juan', T.guard.id]);
  const [visit] = await query('SELECT * FROM visits WHERE id=?', [x.insertId]);
  await handle('visit.decided', { tenantId: T.tenant, visit, actorId: T.owner.id });
  const fam = (await rows(T.family.id)).find((n) => n.entity_id === visit.id);
  const adm = (await rows(T.admin.id)).find((n) => n.entity_id === visit.id);
  assert.equal(fam.type, 'access.rejected');
  assert.equal(fam.priority, 'high');
  assert.match(adm.body, /lote N-1/);
  assert.equal((await rows(T.owner.id)).some((n) => n.entity_id === visit.id), false, 'quien rechazó no se notifica a sí mismo');
});

test('alerta de seguridad: personal sí, residentes solo si la activaron', async () => {
  const incident = { id: 990000 + Math.floor(Math.random() * 9999), type: 'security', lot_code: 'N-1' };
  await handle('incident.created', { tenantId: T.tenant, incident, actorId: T.family.id });
  assert.ok((await rows(T.guard.id)).some((n) => n.type === 'security.alert'));
  assert.ok(!(await rows(T.owner.id)).some((n) => n.type === 'security.alert'));
});

test('recordatorio de vencimiento: una vez por tramo y por usuario', async () => {
  const due = toSql(new Date(Date.now() + 2 * 86400000)).slice(0, 10);
  await query('INSERT INTO expense_settlements (tenant_id,lot_id,period,amount,due_date) VALUES (?,?,?,?,?)', [T.tenant, T.lot, '2099-01', 1000, due]);
  await runReminders();
  await runReminders(); // el job pasa otra vez: no repite
  const own = (await rows(T.owner.id)).filter((n) => n.type === 'expenses.due_soon');
  const fam = (await rows(T.family.id)).filter((n) => n.type === 'expenses.due_soon');
  assert.equal(own.length, 1, 'el propietario eligió [7, 1]: con 2 días corresponde el tramo 7');
  assert.equal(fam.length, 1, 'la familia usa los defaults [3, 1] → tramo 3');
  assert.match(own[0].dedupe_key, /:7$/);
  assert.match(fam[0].dedupe_key, /:3$/);
  assert.equal(fam[0].body, 'Sus expensas vencen en 2 días.');
});
