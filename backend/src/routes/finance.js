// Módulo de expensas: rubros, proveedores, gastos, transparencia, medios de pago, configuración,
// generación de expensas, dashboard y reportes. PUT/DELETE de cada entidad: models/finance.js (lib/crud.js).
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { query, tx } from '../lib/db.js';
import { ah, audit, validate, HttpError } from '../lib/helpers.js';
import { requireRole, hasRole } from '../middleware/auth.js';
import { DOCUMENT_MIME, LIMITS, removeAsset, sendAsset, storeAsset } from '../lib/files.js';
import { computeSettlements, EngineError, METHODS } from '../lib/expenseEngine.js';
import { sendReport } from '../lib/exporter.js';
import { publish } from '../notifications/events.js';
import { PAYMENT_TYPES, VOUCHER_TYPES, dataSchemaFor, zCuit } from '../models/finance.js';
import { zDate, zOptText } from '../lib/crud.js';

const r = Router();
const ADMIN = ['admin'];
const VIEWERS = ['admin', 'owner', 'family']; // transparencia: propietarios y familiares
const zPeriod = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Período AAAA-MM');
const currentPeriod = () => new Date().toISOString().slice(0, 7);
const prevPeriod = (p) => { const [y, m] = p.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const page = (q) => {
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
  return { limit, offset: (Math.max(Number(q.page) || 1, 1) - 1) * limit };
};

const voucherUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.document * 1024 * 1024, files: 1 },
  fileFilter: (req, f, cb) => (DOCUMENT_MIME.includes(f.mimetype) ? cb(null, true) : cb(new HttpError(415, 'El comprobante debe ser PDF, JPG, PNG o WebP'))),
});

// ======================= Rubros =======================
r.get('/expense-categories', requireRole(...ADMIN), ah(async (req, res) => {
  res.json(await query(
    `SELECT c.*, (SELECT COUNT(*) FROM expenditures e WHERE e.category_id=c.id) AS expenditures_count
     FROM expense_categories c WHERE c.tenant_id=? ORDER BY c.sort_order, c.name`, [req.tenantId]));
}));

r.post('/expense-categories', requireRole(...ADMIN),
  validate(z.object({ name: z.string().trim().min(2).max(60) })),
  ah(async (req, res) => {
    const [{ n }] = await query('SELECT COALESCE(MAX(sort_order),0)+1 n FROM expense_categories WHERE tenant_id=?', [req.tenantId]);
    const x = await query('INSERT INTO expense_categories (tenant_id,name,sort_order) VALUES (?,?,?)', [req.tenantId, req.body.name, n])
      .catch((e) => { throw e.code === 'ER_DUP_ENTRY' ? new HttpError(409, `Ya existe el rubro "${req.body.name}"`) : e; });
    await audit(req, 'expense_category', x.insertId, 'create', req.body);
    res.status(201).json({ id: x.insertId });
  }));

// ======================= Proveedores =======================
r.get('/suppliers', requireRole(...ADMIN), ah(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const params = [req.tenantId];
  let where = 's.tenant_id=?';
  if (q) { where += ' AND (s.legal_name LIKE ? OR s.trade_name LIKE ? OR s.cuit LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q.replace(/\D/g, '') || q}%`); }
  res.json(await query(
    `SELECT s.*, COUNT(e.id) AS expenditures_count, COALESCE(SUM(e.amount),0) AS total_spent
     FROM suppliers s LEFT JOIN expenditures e ON e.supplier_id=s.id
     WHERE ${where} GROUP BY s.id ORDER BY s.active DESC, s.legal_name LIMIT 500`, params));
}));

r.post('/suppliers', requireRole(...ADMIN),
  validate(z.object({
    legal_name: z.string().trim().min(2).max(160), trade_name: zOptText(160).optional(), cuit: zCuit.optional(),
    email: z.string().trim().email('Email inválido').optional(), phone: zOptText(30).optional(), address: zOptText(200).optional(),
  })),
  ah(async (req, res) => {
    const b = req.body;
    const x = await query('INSERT INTO suppliers (tenant_id,legal_name,trade_name,cuit,email,phone,address) VALUES (?,?,?,?,?,?,?)',
      [req.tenantId, b.legal_name, b.trade_name ?? null, b.cuit ?? null, b.email ?? null, b.phone ?? null, b.address ?? null])
      .catch((e) => { throw e.code === 'ER_DUP_ENTRY' ? new HttpError(409, 'Ya existe un proveedor con ese CUIT') : e; });
    await audit(req, 'supplier', x.insertId, 'create', { legal_name: b.legal_name, cuit: b.cuit });
    res.status(201).json({ id: x.insertId });
  }));

// ======================= Gastos =======================
const expenditureFields = z.object({
  date: zDate, category_id: z.coerce.number().int(), supplier_id: z.coerce.number().int().optional(),
  concept: z.string().trim().min(2).max(200), amount: z.coerce.number().positive('El importe debe ser mayor a 0'),
  voucher_type: z.enum(VOUCHER_TYPES).optional(), voucher_number: zOptText(40).optional(), notes: zOptText(500).optional(),
});

r.get('/expenditures', requireRole(...ADMIN), ah(async (req, res) => {
  const { limit, offset } = page(req.query);
  const params = [req.tenantId];
  let where = 'e.tenant_id=?';
  if (req.query.period) { where += ' AND e.period=?'; params.push(String(req.query.period)); }
  if (req.query.category_id) { where += ' AND e.category_id=?'; params.push(Number(req.query.category_id)); }
  if (req.query.supplier_id) { where += ' AND e.supplier_id=?'; params.push(Number(req.query.supplier_id)); }
  const [{ total, amount }] = await query(`SELECT COUNT(*) total, COALESCE(SUM(e.amount),0) amount FROM expenditures e WHERE ${where}`, params);
  const rows = await query(
    `SELECT e.*, c.name AS category, s.legal_name AS supplier, a.mime AS voucher_mime
     FROM expenditures e JOIN expense_categories c ON c.id=e.category_id
     LEFT JOIN suppliers s ON s.id=e.supplier_id LEFT JOIN tenant_assets a ON a.id=e.asset_id
     WHERE ${where} ORDER BY e.date DESC, e.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  res.json({ rows, total: Number(total), amount: Number(amount), limit, page: offset / limit + 1 });
}));

async function assertRefs(req, b) {
  const [c] = await query('SELECT id FROM expense_categories WHERE id=? AND tenant_id=? AND active=1', [b.category_id, req.tenantId]);
  if (!c) { throw new HttpError(400, 'Rubro inexistente o inactivo'); }
  if (b.supplier_id) {
    const [s] = await query('SELECT id FROM suppliers WHERE id=? AND tenant_id=?', [b.supplier_id, req.tenantId]);
    if (!s) { throw new HttpError(400, 'Proveedor inexistente'); }
  }
}

// Alta con comprobante opcional (multipart: campos + "voucher")
r.post('/expenditures', requireRole(...ADMIN), voucherUpload.single('voucher'), ah(async (req, res) => {
  const parsed = expenditureFields.safeParse(Object.fromEntries(Object.entries(req.body).filter(([, v]) => v !== '')));
  if (!parsed.success) {
    throw new HttpError(400, `Datos inválidos: ${parsed.error.issues.map((i) => `${i.path.join('.')} → ${i.message}`).join('; ')}`);
  }
  const b = parsed.data;
  await assertRefs(req, b);
  const asset = req.file ? await storeAsset(req.tenantId, 'document', req.file) : null;
  try {
    const x = await query(
      `INSERT INTO expenditures (tenant_id,date,period,category_id,supplier_id,concept,amount,voucher_type,voucher_number,notes,asset_id,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [req.tenantId, b.date, b.date.slice(0, 7), b.category_id, b.supplier_id ?? null, b.concept, b.amount.toFixed(2),
        b.voucher_type ?? null, b.voucher_number ?? null, b.notes ?? null, asset?.id ?? null, req.user.id]);
    await audit(req, 'expenditure', x.insertId, 'create', { ...b, voucher: !!asset });
    res.status(201).json({ id: x.insertId });
  } catch (e) {
    if (asset) { await removeAsset(req.tenantId, asset.id); } // no dejar archivos huérfanos
    throw e;
  }
}));

// Reemplaza el comprobante de un gasto (borra el anterior)
r.post('/expenditures/:id/voucher', requireRole(...ADMIN), voucherUpload.single('voucher'), ah(async (req, res) => {
  const [e] = await query('SELECT id, asset_id FROM expenditures WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
  if (!e) { throw new HttpError(404, 'Gasto no encontrado'); }
  const asset = await storeAsset(req.tenantId, 'document', req.file);
  await query('UPDATE expenditures SET asset_id=? WHERE id=?', [asset.id, e.id]);
  if (e.asset_id) { await removeAsset(req.tenantId, e.asset_id); }
  await audit(req, 'expenditure', e.id, 'voucher_update');
  res.json({ ok: true });
}));

// Comprobante (privado): administración, propietarios y familiares del complejo (transparencia)
r.get('/expenditures/:id/voucher', requireRole(...VIEWERS), ah(async (req, res) => {
  const [e] = await query('SELECT asset_id, voucher_type, voucher_number FROM expenditures WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
  if (!e?.asset_id) { throw new HttpError(404, 'El gasto no tiene comprobante'); }
  await sendAsset(res, req.tenantId, e.asset_id, [e.voucher_type, e.voucher_number].filter(Boolean).join(' ') || `gasto-${req.params.id}`);
}));

/** Gastos de un período agrupados por rubro (sin datos internos: no incluye notas ni quién cargó). */
async function expenditureSummary(tenantId, period) {
  const rows = await query(
    `SELECT e.id, e.date, e.concept, e.amount, e.voucher_type, e.voucher_number, e.asset_id IS NOT NULL AS has_voucher,
            c.id AS category_id, c.name AS category, COALESCE(s.trade_name, s.legal_name) AS supplier
     FROM expenditures e JOIN expense_categories c ON c.id=e.category_id LEFT JOIN suppliers s ON s.id=e.supplier_id
     WHERE e.tenant_id=? AND e.period=? ORDER BY c.sort_order, c.name, e.date`, [tenantId, period]);
  const total = rows.reduce((a, x) => a + Number(x.amount), 0);
  const byCat = new Map();
  for (const x of rows) {
    const g = byCat.get(x.category_id) ?? { id: x.category_id, name: x.category, total: 0, items: [] };
    g.total += Number(x.amount);
    g.items.push({ id: x.id, date: x.date, concept: x.concept, supplier: x.supplier, amount: Number(x.amount),
      voucher: [x.voucher_type, x.voucher_number].filter(Boolean).join(' ') || null, has_voucher: !!x.has_voucher });
    byCat.set(x.category_id, g);
  }
  const categories = [...byCat.values()]
    .map((g) => ({ ...g, total: Math.round(g.total * 100) / 100, pct: total ? Math.round((g.total / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.total - a.total);
  return { period, total: Math.round(total * 100) / 100, count: rows.length, categories };
}

r.get('/expenditures/summary', requireRole(...VIEWERS), ah(async (req, res) => {
  const period = zPeriod.catch(currentPeriod()).parse(req.query.period);
  res.json(await expenditureSummary(req.tenantId, period));
}));

// Períodos con gastos o expensas (para el selector)
r.get('/expenditures/periods', requireRole(...VIEWERS), ah(async (req, res) => {
  const rows = await query(
    `SELECT period FROM expenditures WHERE tenant_id=? UNION SELECT period FROM expense_settlements WHERE tenant_id=?
     ORDER BY period DESC LIMIT 60`, [req.tenantId, req.tenantId]);
  res.json(rows.map((x) => x.period));
}));

// ======================= Configuración del complejo =======================
r.get('/expense-config', requireRole(...ADMIN), ah(async (req, res) => {
  const [s] = await query(
    `SELECT t.name, s.display_name, s.legal_name, s.cuit, s.address, s.email, s.phone, a.path AS logo_path,
            t.mp_access_token IS NOT NULL AS mp_linked
     FROM tenants t LEFT JOIN tenant_settings s ON s.tenant_id=t.id LEFT JOIN tenant_assets a ON a.id=s.logo_asset_id
     WHERE t.id=?`, [req.tenantId]);
  res.json({ ...s, mp_linked: !!s.mp_linked, logo_url: s.logo_path ? `/uploads/tenants/${s.logo_path}` : null, logo_path: undefined });
}));

r.put('/expense-config', requireRole(...ADMIN),
  validate(z.object({
    display_name: zOptText(120), legal_name: zOptText(160), cuit: zCuit.nullable().or(z.literal('').transform(() => null)),
    address: zOptText(200), email: z.string().trim().email('Email inválido').or(z.literal('')).nullable().transform((s) => s || null),
    phone: zOptText(30),
  }).partial().strict()),
  ah(async (req, res) => {
    const cols = Object.keys(req.body);
    if (cols.length) {
      await query(
        `INSERT INTO tenant_settings (tenant_id,${cols.join(',')}) VALUES (?,${cols.map(() => '?').join(',')})
         ON DUPLICATE KEY UPDATE ${cols.map((c) => `${c}=VALUES(${c})`).join(',')}`, [req.tenantId, ...cols.map((c) => req.body[c])]);
    }
    await audit(req, 'tenant_settings', req.tenantId, 'update', req.body);
    res.json({ ok: true });
  }));

// ======================= Medios de pago =======================
r.get('/payment-methods', requireRole(...VIEWERS), ah(async (req, res) => {
  const admin = hasRole(req, ...ADMIN);
  const rows = await query(
    `SELECT id, type, label, data, active, sort_order FROM payment_methods WHERE tenant_id=? ${admin ? '' : 'AND active=1'}
     ORDER BY sort_order, id`, [req.tenantId]);
  const [t] = await query('SELECT mp_access_token IS NOT NULL AS linked FROM tenants WHERE id=?', [req.tenantId]);
  res.json({ methods: rows, mercadopago_checkout: !!t.linked });
}));

r.post('/payment-methods', requireRole(...ADMIN),
  validate(z.object({ type: z.enum(PAYMENT_TYPES), label: z.string().trim().min(2).max(80), data: z.record(z.any()).default({}) })),
  ah(async (req, res) => {
    const d = dataSchemaFor(req.body.type).safeParse(req.body.data);
    if (!d.success) { throw new HttpError(400, `Datos inválidos: ${d.error.issues.map((i) => `${i.path.join('.')} → ${i.message}`).join('; ')}`); }
    const [{ n }] = await query('SELECT COALESCE(MAX(sort_order),0)+1 n FROM payment_methods WHERE tenant_id=?', [req.tenantId]);
    const x = await query('INSERT INTO payment_methods (tenant_id,type,label,data,sort_order) VALUES (?,?,?,?,?)',
      [req.tenantId, req.body.type, req.body.label, JSON.stringify(d.data), n]);
    await audit(req, 'payment_method', x.insertId, 'create', { type: req.body.type, label: req.body.label });
    res.status(201).json({ id: x.insertId });
  }));

// ======================= Generación de expensas =======================
const runSchema = z.object({
  period: zPeriod, due_date: zDate, method: z.enum(Object.keys(METHODS)),
  // Sin total: se prorratea la suma de los gastos del período
  total: z.number().positive().optional(),
  params: z.record(z.any()).default({}),
  replace_pending: z.boolean().default(false),
});

async function buildRun(req) {
  const b = req.body;
  const lots = await query('SELECT id, code, share_pct, coefficient, surface_m2 FROM lots WHERE tenant_id=?', [req.tenantId]);
  let total = b.total;
  if (total == null && b.method !== 'fixed') {
    const [{ s }] = await query('SELECT COALESCE(SUM(amount),0) s FROM expenditures WHERE tenant_id=? AND period=?', [req.tenantId, b.period]);
    total = Number(s);
    if (!(total > 0)) { throw new HttpError(422, `No hay gastos cargados en ${b.period}. Cargalos o indicá un total.`); }
  }
  try {
    return { ...computeSettlements({ lots, method: b.method, total, params: b.params }), source: b.total == null ? 'gastos del período' : 'total manual' };
  } catch (e) {
    throw e instanceof EngineError ? new HttpError(422, e.message) : e;
  }
}

r.get('/expense-runs/methods', requireRole(...ADMIN), (req, res) => {
  res.json(Object.entries(METHODS).map(([id, m]) => ({ id, label: m.label })));
});

r.post('/expense-runs/preview', requireRole(...ADMIN), validate(runSchema), ah(async (req, res) => {
  const run = await buildRun(req);
  const existing = await query('SELECT lot_id, status FROM expense_settlements WHERE tenant_id=? AND period=?', [req.tenantId, req.body.period]);
  res.json({ ...run, existing: { total: existing.length, pending: existing.filter((x) => x.status === 'pending').length } });
}));

r.post('/expense-runs', requireRole(...ADMIN), validate(runSchema), ah(async (req, res) => {
  const b = req.body;
  const run = await buildRun(req);
  const result = await tx(async (c) => {
    const [existing] = await c.execute('SELECT id, lot_id, status FROM expense_settlements WHERE tenant_id=? AND period=? FOR UPDATE', [req.tenantId, b.period]);
    if (existing.length && !b.replace_pending) {
      throw new HttpError(409, `El período ${b.period} ya tiene ${existing.length} expensa(s) emitida(s). Usá "reemplazar pendientes" para recalcular las que no tienen pagos.`);
    }
    const locked = existing.filter((x) => x.status !== 'pending');
    const byLot = new Map(existing.map((x) => [x.lot_id, x]));
    const [ins] = await c.execute(
      'INSERT INTO expense_runs (tenant_id,period,method,params,total,lots_count,due_date,created_by) VALUES (?,?,?,?,?,?,?,?)',
      [req.tenantId, b.period, b.method, JSON.stringify(b.params), run.total, run.rows.length, b.due_date, req.user.id]);
    let created = 0, updated = 0, skipped = 0;
    for (const row of run.rows) {
      const prev = byLot.get(row.lot_id);
      const detail = `Expensas ${b.period} · ${METHODS[b.method].label}`;
      if (!prev) {
        await c.execute(
          'INSERT INTO expense_settlements (tenant_id,lot_id,period,amount,due_date,detail,run_id,breakdown) VALUES (?,?,?,?,?,?,?,?)',
          [req.tenantId, row.lot_id, b.period, row.amount.toFixed(2), b.due_date, detail, ins.insertId, JSON.stringify(row.detail)]);
        created++;
      } else if (prev.status === 'pending') {
        await c.execute('UPDATE expense_settlements SET amount=?, due_date=?, detail=?, run_id=?, breakdown=? WHERE id=?',
          [row.amount.toFixed(2), b.due_date, detail, ins.insertId, JSON.stringify(row.detail), prev.id]);
        updated++;
      } else {
        skipped++; // ya tiene un pago informado o aprobado: no se toca
      }
    }
    return { run_id: ins.insertId, created, updated, skipped, locked: locked.length };
  });
  await audit(req, 'expense_run', result.run_id, 'generate', { period: b.period, method: b.method, total: run.total, ...result });
  // Aviso a los responsables de cada lote liquidado (en segundo plano)
  const lots = await query('SELECT DISTINCT lot_id FROM expense_settlements WHERE run_id=? AND tenant_id=?', [result.run_id, req.tenantId]);
  publish('expenses.published', { tenantId: req.tenantId, runId: result.run_id, period: b.period, lotIds: lots.map((l) => l.lot_id), actorId: req.user.id });
  res.status(201).json({ ...result, total: run.total });
}));

r.get('/expense-runs', requireRole(...ADMIN), ah(async (req, res) => {
  res.json(await query(
    `SELECT r.*, u.full_name AS created_by_name FROM expense_runs r LEFT JOIN users u ON u.id=r.created_by
     WHERE r.tenant_id=? ORDER BY r.created_at DESC LIMIT 100`, [req.tenantId]));
}));

// ======================= Dashboard administrativo =======================
r.get('/expense-dashboard', requireRole(...ADMIN), ah(async (req, res) => {
  const period = zPeriod.catch(currentPeriod()).parse(req.query.period);
  const prev = prevPeriod(period);
  const today = new Date().toISOString().slice(0, 10);
  // Pocas consultas agregadas (sin N+1)
  const [[s], [spent], [lotsCount], [owners], [overdue]] = await Promise.all([
    query(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) emitted, COALESCE(SUM(CASE WHEN status='paid' THEN amount END),0) collected,
                  COALESCE(SUM(CASE WHEN status<>'paid' THEN amount END),0) pending
           FROM expense_settlements WHERE tenant_id=? AND period=?`, [req.tenantId, period]),
    query(`SELECT COALESCE(SUM(CASE WHEN period=? THEN amount END),0) cur, COALESCE(SUM(CASE WHEN period=? THEN amount END),0) prev
           FROM expenditures WHERE tenant_id=? AND period IN (?,?)`, [period, prev, req.tenantId, period, prev]),
    query('SELECT COUNT(*) n FROM lots WHERE tenant_id=?', [req.tenantId]),
    query(`SELECT COUNT(DISTINCT u.id) n FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles ro ON ro.id=ur.role_id
           WHERE u.tenant_id=? AND ro.name='owner' AND u.active=1`, [req.tenantId]),
    query(`SELECT COUNT(DISTINCT lot_id) lots, COALESCE(SUM(amount),0) amount FROM expense_settlements
           WHERE tenant_id=? AND status<>'paid' AND due_date<?`, [req.tenantId, today]),
  ]);
  const emitted = Number(s.emitted);
  const lots = Number(lotsCount.n);
  res.json({
    period,
    emitted, issued_count: Number(s.n), collected: Number(s.collected), pending: Number(s.pending),
    collection_rate: emitted ? Math.round((Number(s.collected) / emitted) * 1000) / 10 : 0,
    // Morosidad: lotes con al menos una expensa vencida impaga, sobre el total de lotes
    delinquency_rate: lots ? Math.round((Number(overdue.lots) / lots) * 1000) / 10 : 0,
    overdue_amount: Number(overdue.amount), overdue_lots: Number(overdue.lots),
    expenses: Number(spent.cur), expenses_prev: Number(spent.prev),
    expenses_variation: Number(spent.prev) ? Math.round(((Number(spent.cur) - Number(spent.prev)) / Number(spent.prev)) * 1000) / 10 : null,
    lots, owners: Number(owners.n),
  });
}));

// ======================= Reportes (Excel / PDF) =======================
async function tenantHeader(tenantId) {
  const [t] = await query(
    `SELECT t.name AS display_name, s.legal_name, s.cuit, s.address, a.path AS logo_path FROM tenants t
     LEFT JOIN tenant_settings s ON s.tenant_id=t.id LEFT JOIN tenant_assets a ON a.id=s.logo_asset_id AND a.private=0
     WHERE t.id=?`, [tenantId]);
  return { ...t, cuit: t.cuit ? `${t.cuit.slice(0, 2)}-${t.cuit.slice(2, 10)}-${t.cuit.slice(10)}` : null };
}
const fmtDate = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

// Rendición de gastos del período (también para propietarios: transparencia)
r.get('/expense-reports/expenditures', requireRole(...VIEWERS), ah(async (req, res) => {
  const period = zPeriod.catch(currentPeriod()).parse(req.query.period);
  const sum = await expenditureSummary(req.tenantId, period);
  const cols = [{ key: 'date', label: 'Fecha', width: 10 }, { key: 'supplier', label: 'Proveedor', width: 22 },
    { key: 'concept', label: 'Concepto', width: 30 }, { key: 'voucher', label: 'Comprobante', width: 18 }, { key: 'amount', label: 'Importe', money: true, width: 14 }];
  await sendReport(res, {
    title: `Rendición de gastos ${period}`,
    subtitle: `Total del período: ${sum.total.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })} · ${sum.count} comprobantes`,
    tenant: await tenantHeader(req.tenantId),
    filename: `gastos-${period}`,
    sections: [
      { title: 'Resumen por rubro', columns: [{ key: 'name', label: 'Rubro', width: 30 }, { key: 'pct', label: '%', width: 8 }, { key: 'total', label: 'Total', money: true, width: 16 }],
        rows: sum.categories.map((c) => ({ ...c, pct: `${c.pct}%` })), totals: { name: 'TOTAL', pct: '100%', total: sum.total } },
      ...sum.categories.map((c) => ({ title: c.name, columns: cols,
        rows: c.items.map((i) => ({ ...i, date: fmtDate(i.date), voucher: i.voucher || '' })), totals: { concept: 'Subtotal', amount: c.total } })),
    ],
  }, req.query.format);
}));

// Estado de cobranza del período (solo administración: tiene datos de todos los lotes)
r.get('/expense-reports/collections', requireRole(...ADMIN), ah(async (req, res) => {
  const period = zPeriod.catch(currentPeriod()).parse(req.query.period);
  const rows = await query(
    `SELECT l.code AS lot, s.amount, s.due_date, s.status,
            (SELECT p.receipt_number FROM expense_payments p WHERE p.settlement_id=s.id AND p.status='approved' LIMIT 1) AS receipt
     FROM expense_settlements s JOIN lots l ON l.id=s.lot_id WHERE s.tenant_id=? AND s.period=? ORDER BY l.code`, [req.tenantId, period]);
  const STATUS = { pending: 'Pendiente', in_review: 'En revisión', paid: 'Pagada' };
  const sumBy = (st) => rows.filter((x) => !st || x.status === st).reduce((a, x) => a + Number(x.amount), 0);
  await sendReport(res, {
    title: `Estado de cobranza ${period}`,
    subtitle: `Emitido ${sumBy().toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })} · Cobrado ${sumBy('paid').toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}`,
    tenant: await tenantHeader(req.tenantId),
    filename: `cobranza-${period}`,
    sections: [{ title: 'Expensas por lote',
      columns: [{ key: 'lot', label: 'Lote', width: 10 }, { key: 'due', label: 'Vencimiento', width: 12 }, { key: 'status', label: 'Estado', width: 12 },
        { key: 'receipt', label: 'Recibo', width: 14 }, { key: 'amount', label: 'Importe', money: true, width: 14 }],
      rows: rows.map((x) => ({ ...x, due: fmtDate(x.due_date), status: STATUS[x.status], receipt: x.receipt || '' })),
      totals: { lot: 'TOTAL', amount: sumBy() } }],
  }, req.query.format);
}));

export default r;
