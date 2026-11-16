// Portal del propietario: estado de cuenta e historiales. Mismo login y roles del sistema.
// Cada consulta se limita a los lotes del usuario (lib/ownership.js): nunca datos de terceros.
import { Router } from 'express';
import { query } from '../lib/db.js';
import { ah } from '../lib/helpers.js';
import { requireRole } from '../middleware/auth.js';
import { inLots, userLotIds } from '../lib/ownership.js';

const r = Router();
const PORTAL = ['owner', 'family'];
const today = () => new Date().toISOString().slice(0, 10);
const page = (q) => {
  const limit = Math.min(Math.max(Number(q.limit) || 24, 1), 100);
  return { limit, offset: (Math.max(Number(q.page) || 1, 1) - 1) * limit };
};

r.get('/owner/summary', requireRole(...PORTAL), ah(async (req, res) => {
  const ids = await userLotIds(req);
  const f = inLots('s.lot_id', ids);
  const [lots, rows] = await Promise.all([
    ids.length ? query(`SELECT id, code, address FROM lots WHERE tenant_id=? AND ${inLots('id', ids).sql} ORDER BY code`, [req.tenantId, ...ids]) : [],
    query(`SELECT s.id, s.lot_id, s.period, s.amount, s.due_date, s.status FROM expense_settlements s
           WHERE s.tenant_id=? AND ${f.sql} AND s.status<>'paid' OR (s.tenant_id=? AND ${f.sql} AND s.period=(
             SELECT MAX(period) FROM expense_settlements x WHERE x.tenant_id=? AND ${inLots('x.lot_id', ids).sql}))`,
      [req.tenantId, ...f.params, req.tenantId, ...f.params, req.tenantId, ...f.params]),
  ]);
  const latest = rows.reduce((m, x) => (x.period > m ? x.period : m), '');
  const current = rows.filter((x) => x.period === latest);
  const pending = rows.filter((x) => x.status === 'pending');
  const inReview = rows.filter((x) => x.status === 'in_review');
  const sum = (list) => Math.round(list.reduce((a, x) => a + Number(x.amount), 0) * 100) / 100;
  const t = today();
  const overdue = pending.filter((x) => x.due_date < t);
  const next = pending.filter((x) => x.due_date >= t).sort((a, b) => a.due_date.localeCompare(b.due_date))[0] || overdue[0] || null;
  res.json({
    lots,
    current: { period: latest || null, amount: sum(current), paid: current.length > 0 && current.every((x) => x.status === 'paid') },
    // Deuda acumulada: expensas impagas de períodos anteriores al actual
    debt: sum(pending.filter((x) => x.period < latest)),
    total_to_pay: sum(pending),
    in_review: sum(inReview),
    next_due: next ? { date: next.due_date, period: next.period, amount: Number(next.amount) } : null,
    status: overdue.length ? 'overdue' : pending.length ? 'pending' : 'up_to_date',
    overdue_count: overdue.length,
  });
}));

r.get('/owner/settlements', requireRole(...PORTAL), ah(async (req, res) => {
  const ids = await userLotIds(req);
  const f = inLots('s.lot_id', ids);
  const { limit, offset } = page(req.query);
  const rows = await query(
    `SELECT s.id, s.period, s.amount, s.due_date, s.status, s.detail, l.code AS lot_code,
            CASE WHEN s.status='paid' THEN 0 ELSE s.amount END AS balance,
            (SELECT p.receipt_number FROM expense_payments p WHERE p.settlement_id=s.id AND p.status='approved' LIMIT 1) AS receipt_number
     FROM expense_settlements s JOIN lots l ON l.id=s.lot_id
     WHERE s.tenant_id=? AND ${f.sql} ORDER BY s.period DESC, l.code LIMIT ${limit} OFFSET ${offset}`, [req.tenantId, ...f.params]);
  res.json({ rows, page: offset / limit + 1, limit });
}));

r.get('/owner/payments', requireRole(...PORTAL), ah(async (req, res) => {
  const ids = await userLotIds(req);
  const f = inLots('s.lot_id', ids);
  const { limit, offset } = page(req.query);
  const rows = await query(
    `SELECT p.id, p.created_at, p.amount, p.method, p.status, p.receipt_number, p.receipt_path IS NOT NULL AS has_file,
            s.period, l.code AS lot_code
     FROM expense_payments p JOIN expense_settlements s ON s.id=p.settlement_id JOIN lots l ON l.id=s.lot_id
     WHERE p.tenant_id=? AND ${f.sql} ORDER BY p.created_at DESC LIMIT ${limit} OFFSET ${offset}`, [req.tenantId, ...f.params]);
  res.json({ rows: rows.map((x) => ({ ...x, has_file: !!x.has_file })), page: offset / limit + 1, limit });
}));

export default r;
