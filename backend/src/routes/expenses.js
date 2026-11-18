import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { query, tx } from '../lib/db.js';
import { RECEIPTS_DIR } from '../lib/paths.js';
import { ah, audit, validate, HttpError } from '../lib/helpers.js';
import { requireRole, hasRole } from '../middleware/auth.js';
import { assertLotAccess, inLots, userLotIds } from '../lib/ownership.js';

const r = Router();
const ADMIN = ['admin'];

const excelUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const receiptUpload = multer({
  storage: multer.diskStorage({
    destination: RECEIPTS_DIR,
    filename: (req, f, cb) => cb(null, crypto.randomUUID() + path.extname(f.originalname).toLowerCase()),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, f, cb) => cb(null, ['image/jpeg', 'image/png', 'application/pdf'].includes(f.mimetype)),
});

/**
 * Importa Excel. Columnas esperadas (fila 1 = encabezados):
 * lote | periodo (YYYY-MM) | importe | vencimiento (YYYY-MM-DD) | detalle
 */
r.post('/expenses/import', requireRole(...ADMIN), excelUpload.single('file'), ah(async (req, res) => {
  if (!req.file) { throw new HttpError(400, 'Archivo requerido'); }
  const wb = XLSX.read(req.file.buffer, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
  const lots = Object.fromEntries((await query('SELECT id,code FROM lots WHERE tenant_id=?', [req.tenantId])).map((l) => [String(l.code), l.id]));
  const errors = [];
  const valid = [];
  rows.forEach((row, i) => {
    const n = (k) => row[k] ?? row[k.toUpperCase()] ?? row[k[0].toUpperCase() + k.slice(1)];
    const lotId = lots[String(n('lote') ?? '').trim()];
    const period = String(n('periodo') ?? '').trim();
    const amount = Number(n('importe'));
    const due = n('vencimiento');
    const dueStr = due instanceof Date ? due.toISOString().slice(0, 10) : String(due ?? '').slice(0, 10);
    const error = !lotId ? 'Lote inexistente'
      : !/^\d{4}-\d{2}$/.test(period) ? 'Periodo inválido'
        : !(amount > 0) ? 'Importe inválido'
          : !/^\d{4}-\d{2}-\d{2}$/.test(dueStr) ? 'Vencimiento inválido' : null;
    if (error) {
      errors.push({ fila: i + 2, error });
    } else {
      valid.push([req.tenantId, lotId, period, amount.toFixed(2), dueStr, n('detalle') ? String(n('detalle')).slice(0, 500) : null]);
    }
  });
  if (errors.length) { return res.status(422).json({ error: 'El archivo tiene errores; no se importó nada', errors }); }
  await tx(async (c) => {
    for (const v of valid) {
      await c.execute(
        `INSERT INTO expense_settlements (tenant_id,lot_id,period,amount,due_date,detail) VALUES (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE amount=IF(status='paid',amount,VALUES(amount)), due_date=VALUES(due_date), detail=VALUES(detail)`, v);
    }
  });
  await audit(req, 'expense_import', null, 'import', { rows: valid.length, file: req.file.originalname });
  res.json({ imported: valid.length });
}));

// Saldos: admin ve todos los lotes; propietario y familiares, solo los suyos (lib/ownership.js)
r.get('/expenses', ah(async (req, res) => {
  const params = [req.tenantId];
  let where = 's.tenant_id=?';
  if (!hasRole(req, ...ADMIN)) {
    const f = inLots('s.lot_id', await userLotIds(req));
    where += ` AND ${f.sql}`;
    params.push(...f.params);
  }
  res.json(await query(
    `SELECT s.*, l.code AS lot_code,
       (SELECT p.receipt_number FROM expense_payments p WHERE p.settlement_id=s.id AND p.status='approved' LIMIT 1) AS receipt_number
     FROM expense_settlements s JOIN lots l ON l.id=s.lot_id WHERE ${where} ORDER BY s.period DESC, l.code`, params));
}));

r.get('/expenses/payments', requireRole(...ADMIN), ah(async (req, res) => {
  res.json(await query(
    `SELECT p.*, s.period, s.amount AS due_amount, l.code AS lot_code FROM expense_payments p
     JOIN expense_settlements s ON s.id=p.settlement_id JOIN lots l ON l.id=s.lot_id
     WHERE p.tenant_id=? ORDER BY p.created_at DESC LIMIT 300`, [req.tenantId]));
}));

async function getSettlement(req, id) {
  const [s] = await query('SELECT * FROM expense_settlements WHERE id=? AND tenant_id=?', [id, req.tenantId]);
  if (!s) { throw new HttpError(404, 'Liquidación no encontrada'); }
  await assertLotAccess(req, s.lot_id);
  if (s.status !== 'pending') { throw new HttpError(409, 'La liquidación ya tiene un pago registrado'); }
  return s;
}

// Regla de negocio: no se aceptan pagos parciales (ni excedentes)
const assertFullAmount = (s, amount) => {
  if (Math.round(Number(amount) * 100) !== Math.round(Number(s.amount) * 100)) { throw new HttpError(422, `No se aceptan pagos parciales. Importe requerido: $${s.amount}`); }
};

const nextReceipt = (id) => `R-${String(id).padStart(8, '0')}`;

// Propietario informa transferencia con comprobante → queda en revisión
r.post('/expenses/:id/transfer', requireRole('owner', 'admin'), receiptUpload.single('receipt'), ah(async (req, res) => {
  if (!req.file) { throw new HttpError(400, 'Comprobante requerido (JPG, PNG o PDF)'); }
  const s = await getSettlement(req, req.params.id);
  assertFullAmount(s, req.body.amount);
  const x = await tx(async (c) => {
    const [p] = await c.execute(
      "INSERT INTO expense_payments (tenant_id,settlement_id,method,amount,receipt_path,registered_by) VALUES (?,?,'transfer',?,?,?)",
      [req.tenantId, s.id, s.amount, req.file.filename, req.user.id]);
    await c.execute("UPDATE expense_settlements SET status='in_review' WHERE id=?", [s.id]);
    return p;
  });
  await audit(req, 'expense_payment', x.insertId, 'transfer_reported', { settlement: s.id });
  res.status(201).json({ id: x.insertId });
}));

// Admin registra pago en efectivo → aprobado directo + recibo
r.post('/expenses/:id/cash', requireRole(...ADMIN), validate(z.object({ amount: z.number().positive() })), ah(async (req, res) => {
  const s = await getSettlement(req, req.params.id);
  assertFullAmount(s, req.body.amount);
  const receipt = await tx(async (c) => {
    const [p] = await c.execute(
      "INSERT INTO expense_payments (tenant_id,settlement_id,method,amount,status,registered_by,reviewed_by) VALUES (?,?,'cash',?,'approved',?,?)",
      [req.tenantId, s.id, s.amount, req.user.id, req.user.id]);
    const num = nextReceipt(p.insertId);
    await c.execute('UPDATE expense_payments SET receipt_number=? WHERE id=?', [num, p.insertId]);
    await c.execute("UPDATE expense_settlements SET status='paid' WHERE id=?", [s.id]);
    return num;
  });
  await audit(req, 'expense_payment', s.id, 'cash_registered', { receipt });
  res.status(201).json({ receipt_number: receipt });
}));

// Admin aprueba/rechaza transferencia
r.post('/expenses/payments/:id/review', requireRole(...ADMIN), validate(z.object({ approve: z.boolean() })), ah(async (req, res) => {
  const [p] = await query("SELECT * FROM expense_payments WHERE id=? AND tenant_id=? AND status='pending'", [req.params.id, req.tenantId]);
  if (!p) { throw new HttpError(404, 'Pago no encontrado'); }
  await tx(async (c) => {
    if (req.body.approve) {
      await c.execute("UPDATE expense_payments SET status='approved', reviewed_by=?, receipt_number=? WHERE id=?",
        [req.user.id, nextReceipt(p.id), p.id]);
      await c.execute("UPDATE expense_settlements SET status='paid' WHERE id=?", [p.settlement_id]);
    } else {
      await c.execute("UPDATE expense_payments SET status='rejected', reviewed_by=? WHERE id=?", [req.user.id, p.id]);
      await c.execute("UPDATE expense_settlements SET status='pending' WHERE id=?", [p.settlement_id]);
    }
  });
  await audit(req, 'expense_payment', p.id, req.body.approve ? 'approved' : 'rejected');
  res.json({ ok: true });
}));

// Descarga de comprobante (con control de tenant)
r.get('/expenses/payments/:id/receipt-file', ah(async (req, res) => {
  const [p] = await query(
    `SELECT p.receipt_path, s.lot_id FROM expense_payments p JOIN expense_settlements s ON s.id=p.settlement_id
     WHERE p.id=? AND p.tenant_id=?`, [req.params.id, req.tenantId]);
  if (!p?.receipt_path) { throw new HttpError(404, 'Sin comprobante'); }
  await assertLotAccess(req, p.lot_id);
  res.sendFile(path.join(RECEIPTS_DIR, path.basename(p.receipt_path)));
}));

export default r;
