import { Router } from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { query, tx } from '../lib/db.js';
import { ah, audit, HttpError } from '../lib/helpers.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { emitToUser } from '../lib/realtime.js';
import { publish } from '../notifications/events.js';
import { assertLotAccess } from '../lib/ownership.js';

const MP = process.env.MP_API_BASE || 'https://api.mercadopago.com';
// Pantallas a las que puede volver el admin después de autorizar (evita redirecciones abiertas)
const OAUTH_RETURNS = ['/admin', '/expensas'];

async function mpFetch(token, path, opts = {}) {
  const res = await fetch(MP + path, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { throw new HttpError(502, `MercadoPago: ${data.message || res.status}`); }
  return data;
}

async function tenantToken(tenantId) {
  const [t] = await query('SELECT mp_access_token FROM tenants WHERE id=?', [tenantId]);
  if (!t?.mp_access_token) { throw new HttpError(400, 'El complejo no tiene MercadoPago configurado'); }
  return t.mp_access_token;
}

const nextReceipt = (id) => `R-${String(id).padStart(8, '0')}`;

/**
 * Acredita una expensa pagada con MercadoPago (webhook). Idempotente: el mismo pago nunca se registra dos veces
 * (índice único en mp_payment_id). Solo se acredita el importe total (regla de no pagos parciales).
 */
async function settleExpenseFromMp(tenantId, settlementId, userId, payment) {
  const log = (action, data) => query("INSERT INTO audit_log (tenant_id,user_id,entity,entity_id,action,data) VALUES (?,?,'expense_settlement',?,?,?)",
    [tenantId, userId || null, settlementId, action, JSON.stringify({ payment_id: String(payment.id), status: payment.status, ...data })]);
  if (payment.status !== 'approved') { return log('mp_webhook', {}); }
  const result = await tx(async (c) => {
    const [[s]] = await c.execute('SELECT * FROM expense_settlements WHERE id=? AND tenant_id=? FOR UPDATE', [settlementId, tenantId]);
    if (!s) { return { skip: 'liquidación inexistente' }; }
    const [[dup]] = await c.execute('SELECT id FROM expense_payments WHERE mp_payment_id=?', [String(payment.id)]);
    if (dup) { return { skip: 'pago ya registrado' }; }
    if (Math.round(Number(payment.transaction_amount) * 100) !== Math.round(Number(s.amount) * 100)) { return { skip: 'importe distinto al de la expensa' }; }
    if (s.status === 'paid') { return { skip: 'la expensa ya estaba pagada' }; }
    const [p] = await c.execute(
      `INSERT INTO expense_payments (tenant_id,settlement_id,method,amount,status,registered_by,mp_payment_id)
       VALUES (?,?,'mercadopago',?,'approved',?,?)`, [tenantId, s.id, s.amount, userId, String(payment.id)]);
    await c.execute('UPDATE expense_payments SET receipt_number=? WHERE id=?', [nextReceipt(p.insertId), p.insertId]);
    await c.execute("UPDATE expense_settlements SET status='paid' WHERE id=?", [s.id]);
    return { paymentId: p.insertId, receipt: nextReceipt(p.insertId) };
  });
  await log(result.skip ? 'mp_webhook_ignored' : 'mp_payment_registered', result);
  if (!result.skip && userId) { emitToUser(userId, 'expenses:updated', { settlement_id: settlementId, status: 'paid' }); }
}

// ---------- Rutas públicas (sin JWT) ----------
export const publicPayments = Router();

/**
 * Webhook de MercadoPago. El tenant viaja en notification_url (?tenant=ID),
 * pero NO se confía en él: se consulta el pago con el token del tenant y se valida
 * que external_reference corresponda a una reserva de ese tenant.
 */
publicPayments.post('/webhook', ah(async (req, res) => {
  const type = req.body?.type || req.query.type || req.query.topic;
  const paymentId = String(req.body?.data?.id || req.query['data.id'] || req.query.id || '');
  const tenantId = Number(req.query.tenant);

  // Validación de firma x-signature (si hay secreto configurado)
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (secret) {
    const sig = Object.fromEntries(String(req.headers['x-signature'] || '').split(',').map((p) => p.trim().split('=')));
    const manifest = `id:${String(req.query['data.id'] || paymentId).toLowerCase()};request-id:${req.headers['x-request-id']};ts:${sig.ts};`;
    const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
    if (!sig.v1 || sig.v1.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig.v1), Buffer.from(expected))) { return res.status(401).end(); }
  }

  if (type !== 'payment' || !paymentId || !tenantId) { return res.sendStatus(200); }

  const payment = await mpFetch(await tenantToken(tenantId), `/v1/payments/${encodeURIComponent(paymentId)}`);
  const ref = String(payment.external_reference || '').split(':');
  if (Number(ref[0]) !== tenantId) { return res.sendStatus(200); }
  // Expensa: "<tenant>:exp:<liquidación>:<usuario>"
  if (ref[1] === 'exp') {
    await settleExpenseFromMp(tenantId, Number(ref[2]), Number(ref[3]), payment);
    return res.sendStatus(200);
  }
  // Reserva: "<tenant>:<reserva>" (formato original)
  const reservationId = Number(ref[1]);

  const [rv] = await query('SELECT * FROM reservations WHERE id=? AND tenant_id=?', [reservationId, tenantId]);
  if (!rv) { return res.sendStatus(200); }
  if (Number(payment.transaction_amount) !== Number(rv.amount)) { return res.sendStatus(200); }

  const map = { approved: 'approved', rejected: 'rejected', cancelled: 'rejected', refunded: 'refunded', charged_back: 'refunded' };
  const status = map[payment.status] || 'pending';
  await query('UPDATE reservations SET payment_status=?, mp_payment_id=? WHERE id=?', [status, String(payment.id), rv.id]);
  await query(
    "INSERT INTO audit_log (tenant_id,entity,entity_id,action,data) VALUES (?,'reservation',?,'mp_webhook',?)",
    [tenantId, rv.id, JSON.stringify({ payment_id: payment.id, status: payment.status })]);
  emitToUser(rv.user_id, 'reservation:updated', { id: rv.id, payment_status: status });
  // Pago acreditado de una reserva ya aprobada: queda confirmada (el dedupe evita repetir el aviso)
  if (status === 'approved' && rv.status === 'approved') { publish('reservation.confirmed', { tenantId, reservation: rv }); }
  res.sendStatus(200);
}));

// OAuth: MercadoPago redirige acá con ?code=&state=<jwt firmado del admin>
publicPayments.get('/oauth/callback', ah(async (req, res) => {
  const { code, state } = req.query;
  let tenantId;
  let returnTo = '/admin';
  try {
    const p = jwt.verify(String(state), process.env.JWT_SECRET);
    if (p.purpose !== 'mp_oauth') { throw new Error(); }
    tenantId = p.tenant_id;
    returnTo = OAUTH_RETURNS.includes(p.return) ? p.return : '/admin';
  } catch {
    return res.status(400).send('state inválido');
  }
  const r = await fetch(`${MP}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.MP_CLIENT_ID, client_secret: process.env.MP_CLIENT_SECRET, grant_type: 'authorization_code',
      code, redirect_uri: `${process.env.PUBLIC_API_URL}/api/pagos/oauth/callback`,
    }),
  });
  const data = await r.json();
  if (!r.ok) { return res.redirect(`${process.env.PUBLIC_APP_URL}${returnTo}?mp=error`); }
  await query('UPDATE tenants SET mp_access_token=?, mp_refresh_token=? WHERE id=?', [data.access_token, data.refresh_token, tenantId]);
  await query("INSERT INTO audit_log (tenant_id,entity,entity_id,action) VALUES (?,'tenant',?,'mp_oauth_linked')", [tenantId, tenantId]);
  res.redirect(`${process.env.PUBLIC_APP_URL}${returnTo}?mp=ok`);
}));

// ---------- Rutas autenticadas ----------
export const payments = Router();
payments.use(authenticate);

payments.get('/oauth/url', requireRole('admin'), (req, res) => {
  if (!process.env.MP_CLIENT_ID || !process.env.PUBLIC_API_URL) {
    return res.status(503).json({ error: 'Falta configurar MP_CLIENT_ID, MP_CLIENT_SECRET y PUBLIC_API_URL en el servidor' });
  }
  const ret = OAUTH_RETURNS.includes(req.query.return) ? req.query.return : '/admin';
  // state de un solo propósito y corta vida (nunca el JWT de sesión en una URL)
  const state = jwt.sign({ tenant_id: req.tenantId, purpose: 'mp_oauth', return: ret }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const url = new URL('https://auth.mercadopago.com/authorization');
  url.search = new URLSearchParams({
    client_id: process.env.MP_CLIENT_ID || '', response_type: 'code', platform_id: 'mp', state,
    redirect_uri: `${process.env.PUBLIC_API_URL}/api/pagos/oauth/callback`,
  });
  res.json({ url: url.toString() });
});

payments.get('/oauth/status', requireRole('admin'), ah(async (req, res) => {
  const [t] = await query('SELECT mp_access_token IS NOT NULL AS linked FROM tenants WHERE id=?', [req.tenantId]);
  res.json({ linked: !!t.linked, configured: !!(process.env.MP_CLIENT_ID && process.env.PUBLIC_API_URL) });
}));

payments.delete('/oauth', requireRole('admin'), ah(async (req, res) => {
  await query('UPDATE tenants SET mp_access_token=NULL, mp_refresh_token=NULL WHERE id=?', [req.tenantId]);
  await audit(req, 'tenant', req.tenantId, 'mp_oauth_unlinked');
  res.json({ linked: false });
}));

// Pago de una expensa con MercadoPago (Checkout Pro). Solo el propietario y por el total.
payments.post('/expenses/:id/preference', requireRole('owner'), ah(async (req, res) => {
  const [s] = await query(
    'SELECT s.*, l.code AS lot_code FROM expense_settlements s JOIN lots l ON l.id=s.lot_id WHERE s.id=? AND s.tenant_id=?',
    [req.params.id, req.tenantId]);
  if (!s) { throw new HttpError(404, 'Expensa no encontrada'); }
  await assertLotAccess(req, s.lot_id);
  if (s.status !== 'pending') { throw new HttpError(409, s.status === 'paid' ? 'La expensa ya está pagada' : 'La expensa tiene un pago en revisión'); }
  const pref = await mpFetch(await tenantToken(req.tenantId), '/checkout/preferences', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': `exp-${req.tenantId}-${s.id}-${Date.now()}` },
    body: JSON.stringify({
      items: [{ title: `Expensas ${s.period} · Lote ${s.lot_code}`, quantity: 1, unit_price: Number(s.amount), currency_id: 'ARS' }],
      external_reference: `${req.tenantId}:exp:${s.id}:${req.user.id}`,
      notification_url: `${process.env.PUBLIC_API_URL}/api/pagos/webhook?tenant=${req.tenantId}`,
      back_urls: {
        success: `${process.env.PUBLIC_APP_URL}/expensas?pago=ok`,
        failure: `${process.env.PUBLIC_APP_URL}/expensas?pago=error`,
        pending: `${process.env.PUBLIC_APP_URL}/expensas?pago=pendiente`,
      },
      auto_return: 'approved',
    }),
  });
  await audit(req, 'expense_settlement', s.id, 'mp_preference', { preference: pref.id });
  res.json({ init_point: pref.init_point });
}));

// Crea preferencia de pago para una reserva y devuelve init_point
payments.post('/reservations/:id/preference', ah(async (req, res) => {
  const [rv] = await query(
    `SELECT r.*, s.name AS space_name FROM reservations r JOIN spaces s ON s.id=r.space_id
     WHERE r.id=? AND r.tenant_id=? AND r.lot_id=?`, [req.params.id, req.tenantId, req.user.lot_id]);
  if (!rv) { throw new HttpError(404, 'Reserva no encontrada'); }
  if (rv.payment_status !== 'pending' || ['rejected', 'cancelled'].includes(rv.status)) { throw new HttpError(409, 'La reserva no admite pago'); }
  const pref = await mpFetch(await tenantToken(req.tenantId), '/checkout/preferences', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': `res-${req.tenantId}-${rv.id}-${Date.now()}` },
    body: JSON.stringify({
      items: [{ title: `Reserva ${rv.space_name} ${rv.start_at}`, quantity: 1, unit_price: Number(rv.amount), currency_id: 'ARS' }],
      external_reference: `${req.tenantId}:${rv.id}`,
      notification_url: `${process.env.PUBLIC_API_URL}/api/pagos/webhook?tenant=${req.tenantId}`,
      back_urls: {
        success: `${process.env.PUBLIC_APP_URL}/reservas?pago=ok`,
        failure: `${process.env.PUBLIC_APP_URL}/reservas?pago=error`,
        pending: `${process.env.PUBLIC_APP_URL}/reservas?pago=pendiente`,
      },
      auto_return: 'approved',
    }),
  });
  await query('UPDATE reservations SET mp_preference_id=? WHERE id=?', [pref.id, rv.id]);
  await audit(req, 'reservation', rv.id, 'mp_preference', { preference: pref.id });
  res.json({ init_point: pref.init_point });
}));

export default payments;
