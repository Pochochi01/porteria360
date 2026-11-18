import { useMemo, useState } from 'react';
import { api, errMsg } from '../../lib/api';
import { useFetch } from '../../hooks/useFetch';
import { useCrud } from '../../hooks/useCrud';
import { fmtDate, fmtDay, money, opts } from '../../lib/format';
import { Alert, Field } from '../../components/ui';
import { Icon } from '../../components/icons';
import { MetricCard } from '../../components/MetricCard';
import { DocumentViewer } from '../../components/DocumentViewer';
import { downloadFile } from '../../lib/download';
import { PeriodSelect } from './Transparency';

const VOUCHER_TYPES = ['Factura A', 'Factura B', 'Factura C', 'Recibo', 'Ticket', 'Nota de crédito', 'Nota de débito', 'Otro'];
const pct = (n) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n}%`);

// ============================== Dashboard ==============================
export function ExpenseDashboard({ period, onPeriod }) {
  const { data, error } = useFetch(`/expense-dashboard?period=${period}`);
  const exportCollections = (format) => downloadFile(`/expense-reports/collections?period=${period}&format=${format}`, `cobranza-${period}.${format}`);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodSelect value={period} onChange={onPeriod} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => exportCollections('pdf')}><Icon name="file" className="h-4 w-4" />Cobranza PDF</button>
          <button type="button" className="btn-secondary" onClick={() => exportCollections('xlsx')}><Icon name="grid" className="h-4 w-4" />Cobranza Excel</button>
        </div>
      </div>
      <Alert msg={error} />
      {data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard label="Expensas emitidas" value={money(data.emitted)} hint={`${data.issued_count} liquidaciones`} />
          <MetricCard label="Cobrado" value={money(data.collected)} tone="good" hint={`${data.collection_rate}% de lo emitido`} />
          <MetricCard label="Pendiente" value={money(data.pending)} tone={data.pending ? 'warn' : 'good'} />
          <MetricCard label="Morosidad" value={`${data.delinquency_rate}%`} tone={data.delinquency_rate > 10 ? 'bad' : data.delinquency_rate ? 'warn' : 'good'}
            hint={`${data.overdue_lots} lote(s) · ${money(data.overdue_amount)} vencido`} />
          <MetricCard label="Gastos del mes" value={money(data.expenses)} />
          <MetricCard label="Variación mensual" value={pct(data.expenses_variation)} tone={data.expenses_variation > 0 ? 'warn' : 'good'} hint={`Mes anterior: ${money(data.expenses_prev)}`} />
          <MetricCard label="Cantidad de lotes" value={data.lots} />
          <MetricCard label="Total propietarios" value={data.owners} />
        </div>
      )}
    </div>
  );
}

// ============================== Gastos ==============================
export function Expenditures({ period, onPeriod }) {
  const [pageN, setPageN] = useState(1);
  const list = useFetch(`/expenditures?period=${period}&page=${pageN}&limit=25`);
  const cats = useFetch('/expense-categories');
  const sups = useFetch('/suppliers');
  const [form, setForm] = useState(null);
  const [file, setFile] = useState(null);
  const [msg, setMsg] = useState({});
  const [voucher, setVoucher] = useState(null);
  const catOptions = useMemo(() => (cats.data || []).filter((c) => c.active).map((c) => ({ value: String(c.id), label: c.name })), [cats.data]);
  const supOptions = useMemo(() => (sups.data || []).filter((s) => s.active).map((s) => ({ value: String(s.id), label: s.trade_name || s.legal_name })), [sups.data]);

  const crud = useCrud({
    path: '/expenditures', label: 'gasto', onChange: list.reload,
    fields: [
      { name: 'date', label: 'Fecha', type: 'date', required: true },
      { name: 'category_id', label: 'Rubro', type: 'select', required: true, numeric: true, options: catOptions },
      { name: 'supplier_id', label: 'Proveedor', type: 'select', numeric: true, options: supOptions },
      { name: 'concept', label: 'Concepto', required: true },
      { name: 'amount', label: 'Importe', type: 'number', step: '0.01', required: true },
      { name: 'voucher_type', label: 'Tipo de comprobante', type: 'select', options: VOUCHER_TYPES.map((v) => ({ value: v, label: v })) },
      { name: 'voucher_number', label: 'Número de comprobante' },
      { name: 'notes', label: 'Observaciones', type: 'textarea' },
    ],
  });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => v !== '' && fd.append(k, v));
    if (file) { fd.append('voucher', file); }
    try {
      await api.post('/expenditures', fd);
      setMsg({ ok: 'Gasto registrado' });
      setForm(null);
      setFile(null);
      if (form.date.slice(0, 7) !== period) { onPeriod(form.date.slice(0, 7)); } else { list.reload(); }
    } catch (err) { setMsg({ error: errMsg(err) }); }
  };
  const replaceVoucher = async (row, f) => {
    const fd = new FormData();
    fd.append('voucher', f);
    try { await api.post(`/expenditures/${row.id}/voucher`, fd); list.reload(); setMsg({ ok: 'Comprobante actualizado' }); } catch (err) { setMsg({ error: errMsg(err) }); }
  };

  const data = list.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodSelect value={period} onChange={(p) => { setPageN(1); onPeriod(p); }} />
        {!form && <button type="button" className="btn-primary" onClick={() => setForm({ date: `${period}-01`, category_id: '', supplier_id: '', concept: '', amount: '', voucher_type: 'Factura B', voucher_number: '', notes: '' })}>
          <Icon name="receipt" className="h-4 w-4" />Nuevo gasto</button>}
      </div>
      <Alert msg={msg.error} />
      <Alert msg={msg.ok} type="ok" />

      {form && (
        <form onSubmit={save} className="card grid gap-3 md:grid-cols-4">
          <h2 className="font-semibold md:col-span-4">Nuevo gasto</h2>
          <Field label="Fecha"><input className="input" type="date" required value={form.date} onChange={set('date')} /></Field>
          <Field label="Rubro">
            <select className="input" required value={form.category_id} onChange={set('category_id')}>
              <option value="">Elegir…</option>{catOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Proveedor">
            <select className="input" value={form.supplier_id} onChange={set('supplier_id')}>
              <option value="">—</option>{supOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Importe"><input className="input" type="number" step="0.01" min="0.01" required inputMode="decimal" value={form.amount} onChange={set('amount')} /></Field>
          <div className="md:col-span-2"><Field label="Concepto"><input className="input" required maxLength={200} value={form.concept} onChange={set('concept')} /></Field></div>
          <Field label="Tipo de comprobante">
            <select className="input" value={form.voucher_type} onChange={set('voucher_type')}>{VOUCHER_TYPES.map((v) => <option key={v}>{v}</option>)}</select>
          </Field>
          <Field label="Número"><input className="input" maxLength={40} placeholder="0002-00001234" value={form.voucher_number} onChange={set('voucher_number')} /></Field>
          <div className="md:col-span-3"><Field label="Observaciones (internas)"><input className="input" maxLength={500} value={form.notes} onChange={set('notes')} /></Field></div>
          <Field label="Comprobante (PDF o imagen, máx. 10 MB)">
            <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="text-sm" onChange={(e) => setFile(e.target.files[0] || null)} />
          </Field>
          <div className="flex justify-end gap-2 md:col-span-4">
            <button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancelar</button>
            <button className="btn-primary">Guardar gasto</button>
          </div>
        </form>
      )}

      <div className="card overflow-x-auto">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-semibold">{data?.total ?? 0} gasto(s)</span>
          <span>Total del período: <b className="tabular-nums">{money(data?.amount ?? 0)}</b></span>
        </div>
        <table className="table">
          <thead><tr><th>Fecha</th><th>Rubro</th><th>Proveedor</th><th>Concepto</th><th>Comprobante</th><th className="text-right">Importe</th><th /></tr></thead>
          <tbody>
            {data?.rows.map((x) => (
              <tr key={x.id}>
                <td>{fmtDay(x.date)}</td><td>{x.category}</td><td>{x.supplier || '—'}</td><td>{x.concept}</td>
                <td className="whitespace-nowrap">
                  {x.asset_id
                    ? <button type="button" className="text-brand-700 underline dark:text-brand-400" onClick={() => setVoucher(x)}>{[x.voucher_type, x.voucher_number].filter(Boolean).join(' ') || 'Ver'}</button>
                    : <span className="text-slate-400">{[x.voucher_type, x.voucher_number].filter(Boolean).join(' ') || '—'}</span>}
                  <label className="ml-2 cursor-pointer text-xs text-slate-500 hover:underline" title="Adjuntar o reemplazar comprobante">
                    <Icon name="upload" className="inline h-3.5 w-3.5" />
                    <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only"
                      onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { replaceVoucher(x, f); } }} />
                  </label>
                </td>
                <td className="text-right tabular-nums">{money(x.amount)}</td>
                <td className="text-right">{crud.actions({ ...x, date: x.date?.slice(0, 10) })}</td>
              </tr>
            ))}
            {data?.rows.length === 0 && <tr><td colSpan={7} className="text-slate-500">Sin gastos en este período.</td></tr>}
          </tbody>
        </table>
        {data && data.total > data.limit && (
          <div className="mt-3 flex items-center justify-end gap-2 text-sm">
            <button type="button" className="btn-secondary px-2 py-1" disabled={pageN <= 1} onClick={() => setPageN(pageN - 1)} aria-label="Página anterior"><Icon name="chevronLeft" className="h-4 w-4" /></button>
            <span>Página {pageN} de {Math.ceil(data.total / data.limit)}</span>
            <button type="button" className="btn-secondary px-2 py-1" disabled={pageN * data.limit >= data.total} onClick={() => setPageN(pageN + 1)} aria-label="Página siguiente"><Icon name="chevronRight" className="h-4 w-4" /></button>
          </div>
        )}
      </div>
      {crud.ui}
      {voucher && <DocumentViewer url={`/expenditures/${voucher.id}/voucher`} title={[voucher.voucher_type, voucher.voucher_number].filter(Boolean).join(' ') || voucher.concept}
        filename={`comprobante-${voucher.id}`} onClose={() => setVoucher(null)} />}
    </div>
  );
}

// ============================== Generar expensas ==============================
export function GenerateExpenses({ period, onPeriod, onDone }) {
  const lots = useFetch('/lots');
  const methods = useFetch('/expense-runs/methods');
  const runs = useFetch('/expense-runs');
  const [cfg, setCfg] = useState({ method: 'surface', due_date: `${period}-10`, total: '', amount: '', replace: false, mixSurface: 70 });
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState({});
  const lotCrud = useCrud({
    path: '/lots', label: 'lote', onChange: lots.reload,
    fields: [
      { name: 'surface_m2', label: 'Superficie (m²)', type: 'number', step: '0.01' },
      { name: 'coefficient', label: 'Coeficiente', type: 'number', step: '0.000001' },
      { name: 'share_pct', label: 'Porcentaje (%)', type: 'number', step: '0.000001' },
    ],
  });

  const body = () => ({
    period, due_date: cfg.due_date, method: cfg.method, replace_pending: cfg.replace,
    ...(cfg.total !== '' && cfg.method !== 'fixed' ? { total: Number(cfg.total) } : {}),
    params: cfg.method === 'fixed' ? { amount: Number(cfg.amount) }
      : cfg.method === 'mixed' ? { parts: [{ method: 'surface', weight: Number(cfg.mixSurface) }, { method: 'equal', weight: 100 - Number(cfg.mixSurface) }] } : {},
  });
  const doPreview = async (e) => {
    e?.preventDefault();
    setMsg({});
    try { setPreview((await api.post('/expense-runs/preview', body())).data); } catch (err) { setPreview(null); setMsg({ error: errMsg(err) }); }
  };
  const emit = async () => {
    try {
      const { data } = await api.post('/expense-runs', body());
      setMsg({ ok: `Expensas ${period} emitidas: ${data.created} nuevas, ${data.updated} recalculadas${data.skipped ? `, ${data.skipped} con pago sin cambios` : ''}. Se avisó a los propietarios.` });
      setPreview(null);
      runs.reload();
      onDone?.();
    } catch (err) { setMsg({ error: errMsg(err) }); }
  };
  const set = (k) => (e) => { setPreview(null); setCfg((c) => ({ ...c, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })); };
  const sumPct = (lots.data || []).reduce((a, l) => a + Number(l.share_pct || 0), 0);

  return (
    <div className="space-y-4">
      <Alert msg={msg.error} />
      <Alert msg={msg.ok} type="ok" />
      <form onSubmit={doPreview} className="card grid gap-3 md:grid-cols-4">
        <h2 className="font-semibold md:col-span-4">Liquidar expensas</h2>
        <PeriodSelect value={period} onChange={(p) => { setPreview(null); onPeriod(p); }} />
        <Field label="Método">
          <select className="input" value={cfg.method} onChange={set('method')}>
            {(methods.data || []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </Field>
        {cfg.method === 'fixed'
          ? <Field label="Valor fijo por lote"><input className="input" type="number" step="0.01" min="0.01" required value={cfg.amount} onChange={set('amount')} /></Field>
          : <Field label="Total a prorratear (vacío = gastos del período)"><input className="input" type="number" step="0.01" min="0.01" value={cfg.total} onChange={set('total')} placeholder="Automático" /></Field>}
        {cfg.method === 'mixed' && (
          <Field label={`Mixto: ${cfg.mixSurface}% por m² · ${100 - cfg.mixSurface}% partes iguales`}>
            <input type="range" min="0" max="100" step="5" value={cfg.mixSurface} onChange={set('mixSurface')} className="w-full" />
          </Field>
        )}
        <Field label="Vencimiento"><input className="input" type="date" required value={cfg.due_date} onChange={set('due_date')} /></Field>
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input type="checkbox" checked={cfg.replace} onChange={set('replace')} />
          Reemplazar las expensas pendientes del período (las que tienen pagos no se tocan)
        </label>
        <div className="flex justify-end md:col-span-4 md:col-start-1"><button className="btn-primary">Vista previa</button></div>
      </form>

      {preview && (
        <div className="card space-y-3 border-2 border-brand-600">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Vista previa · {preview.rows.length} lotes · {money(preview.total)} <span className="text-xs font-normal text-slate-500">({preview.source})</span></h2>
            <button type="button" className="btn-primary" onClick={emit}>Emitir expensas</button>
          </div>
          {preview.existing.total > 0 && <p className="text-sm text-amber-700 dark:text-amber-300">El período ya tiene {preview.existing.total} expensa(s) ({preview.existing.pending} pendientes).{!cfg.replace && ' Marcá "reemplazar pendientes" para recalcularlas.'}</p>}
          <div className="max-h-80 overflow-y-auto">
            <table className="table">
              <thead><tr><th>Lote</th><th>Participación</th><th className="text-right">Importe</th></tr></thead>
              <tbody>{preview.rows.map((r) => (
                <tr key={r.lot_id}><td>{r.lot_code}</td><td>{r.detail.participacion_pct != null ? `${r.detail.participacion_pct.toFixed(3)}%` : 'fijo'}</td><td className="text-right tabular-nums">{money(r.amount)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Bases de prorrateo por lote</h2>
          <span className={`text-xs ${Math.abs(sumPct - 100) < 0.01 ? 'text-emerald-600' : 'text-slate-500'}`}>Suma de porcentajes: {sumPct.toFixed(4)}%</span>
        </div>
        <table className="table">
          <thead><tr><th>Lote</th><th className="text-right">m²</th><th className="text-right">Coeficiente</th><th className="text-right">%</th><th /></tr></thead>
          <tbody>{(lots.data || []).map((l) => (
            <tr key={l.id}>
              <td>{l.code}</td><td className="text-right tabular-nums">{l.surface_m2 ?? '—'}</td><td className="text-right tabular-nums">{l.coefficient ?? '—'}</td>
              <td className="text-right tabular-nums">{l.share_pct ?? '—'}</td><td className="text-right">{lotCrud.actions(l)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      {!!runs.data?.length && (
        <div className="card overflow-x-auto">
          <h2 className="mb-2 font-semibold">Liquidaciones generadas</h2>
          <table className="table">
            <thead><tr><th>Fecha</th><th>Período</th><th>Método</th><th>Lotes</th><th className="text-right">Total</th><th>Por</th></tr></thead>
            <tbody>{runs.data.map((r) => (
              <tr key={r.id}><td>{fmtDate(r.created_at)}</td><td>{r.period}</td><td>{methods.data?.find((m) => m.id === r.method)?.label || r.method}</td>
                <td>{r.lots_count}</td><td className="text-right tabular-nums">{money(r.total)}</td><td>{r.created_by_name}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {lotCrud.ui}
    </div>
  );
}

// ============================== Rubros ==============================
export function Categories() {
  const list = useFetch('/expense-categories');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const crud = useCrud({
    path: '/expense-categories', label: 'rubro', onChange: list.reload,
    fields: [{ name: 'name', label: 'Nombre', required: true }, { name: 'sort_order', label: 'Orden', type: 'number' }, { name: 'active', label: 'Activo', type: 'checkbox' }],
  });
  const add = async (e) => {
    e.preventDefault();
    try { await api.post('/expense-categories', { name }); setName(''); setMsg(''); list.reload(); } catch (err) { setMsg(errMsg(err)); }
  };
  return (
    <div className="space-y-4">
      <form onSubmit={add} className="card flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1"><Field label="Nuevo rubro"><input className="input" required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
        <button className="btn-primary">Agregar</button>
      </form>
      <Alert msg={msg} />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Orden</th><th>Rubro</th><th>Gastos</th><th>Estado</th><th /></tr></thead>
          <tbody>{(list.data || []).map((c) => (
            <tr key={c.id} className={c.active ? '' : 'opacity-60'}>
              <td>{c.sort_order}</td><td className="font-medium">{c.name}</td><td>{c.expenditures_count}</td><td>{c.active ? 'Activo' : 'Inactivo'}</td>
              <td className="text-right">{crud.actions(c)}</td>
            </tr>
          ))}</tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">Un rubro con gastos no se puede eliminar: desactivalo para que no aparezca en altas nuevas.</p>
      </div>
      {crud.ui}
    </div>
  );
}

// ============================== Proveedores ==============================
const EMPTY_SUPPLIER = { legal_name: '', trade_name: '', cuit: '', email: '', phone: '', address: '' };
export function Suppliers() {
  const [q, setQ] = useState('');
  const list = useFetch(`/suppliers?q=${encodeURIComponent(q)}`);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState('');
  const fields = [
    { name: 'legal_name', label: 'Razón social', required: true }, { name: 'trade_name', label: 'Nombre comercial' },
    { name: 'cuit', label: 'CUIT' }, { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Teléfono' },
    { name: 'address', label: 'Domicilio' }, { name: 'active', label: 'Activo', type: 'checkbox' },
  ];
  const crud = useCrud({ path: '/suppliers', label: 'proveedor', onChange: list.reload, fields });
  const save = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ''));
    try { await api.post('/suppliers', b); setForm(null); setMsg(''); list.reload(); } catch (err) { setMsg(errMsg(err)); }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input className="input max-w-xs" type="search" placeholder="Buscar por nombre o CUIT" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar proveedor" />
        {!form && <button type="button" className="btn-primary" onClick={() => setForm(EMPTY_SUPPLIER)}>Nuevo proveedor</button>}
      </div>
      <Alert msg={msg} />
      {form && (
        <form onSubmit={save} className="card grid gap-3 md:grid-cols-3">
          {fields.filter((f) => f.type !== 'checkbox').map((f) => (
            <Field key={f.name} label={f.label}>
              <input className="input" type={f.type || 'text'} required={f.required} value={form[f.name]}
                onChange={(e) => setForm((v) => ({ ...v, [f.name]: e.target.value }))} placeholder={f.name === 'cuit' ? '30-12345678-9' : undefined} />
            </Field>
          ))}
          <div className="flex justify-end gap-2 md:col-span-3">
            <button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancelar</button>
            <button className="btn-primary">Guardar</button>
          </div>
        </form>
      )}
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Proveedor</th><th>CUIT</th><th>Contacto</th><th className="text-right">Gastos</th><th /></tr></thead>
          <tbody>{(list.data || []).map((s) => (
            <tr key={s.id} className={s.active ? '' : 'opacity-60'}>
              <td><div className="font-medium">{s.legal_name}</div>{s.trade_name && <div className="text-xs text-slate-500">{s.trade_name}</div>}</td>
              <td className="font-mono text-xs">{s.cuit ? `${s.cuit.slice(0, 2)}-${s.cuit.slice(2, 10)}-${s.cuit.slice(10)}` : '—'}</td>
              <td className="text-xs">{[s.email, s.phone].filter(Boolean).join(' · ') || '—'}</td>
              <td className="text-right tabular-nums">{s.expenditures_count} · {money(s.total_spent)}</td>
              <td className="text-right">{crud.actions(s)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {crud.ui}
    </div>
  );
}

// ============================== Medios de pago ==============================
const PM_TYPES = { transfer: 'Transferencia bancaria', mercadopago: 'Mercado Pago (QR / link)', modo: 'MODO', naranjax: 'Naranja X' };
const PM_FIELDS = {
  transfer: [['alias', 'Alias'], ['cbu', 'CBU / CVU (22 dígitos)'], ['bank', 'Banco'], ['holder', 'Titular'], ['cuit', 'CUIT del titular']],
  wallet: [['url', 'Link de pago (https://…)'], ['alias', 'Alias'], ['qr_text', 'Texto del QR (opcional)']],
};
const fieldsOf = (type) => PM_FIELDS[type === 'transfer' ? 'transfer' : 'wallet'];

export function PaymentMethodsAdmin() {
  const list = useFetch('/payment-methods');
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState('');
  const crud = useCrud({
    path: '/payment-methods', label: 'medio de pago', onChange: list.reload,
    fields: [{ name: 'label', label: 'Nombre visible', required: true }, { name: 'sort_order', label: 'Orden', type: 'number' }, { name: 'active', label: 'Activo', type: 'checkbox' }],
  });
  const save = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(fieldsOf(form.type).map(([k]) => [k, form[k] || '']).filter(([, v]) => v !== ''));
    try {
      if (form.id) { await api.put(`/payment-methods/${form.id}`, { label: form.label, data }); } else { await api.post('/payment-methods', { type: form.type, label: form.label, data }); }
      setForm(null); setMsg(''); list.reload();
    } catch (err) { setMsg(errMsg(err)); }
  };
  const edit = (m) => setForm({ id: m.id, type: m.type, label: m.label, ...(typeof m.data === 'string' ? JSON.parse(m.data) : m.data) });
  return (
    <div className="space-y-4">
      {!form && <button type="button" className="btn-primary" onClick={() => setForm({ type: 'transfer', label: '' })}>Agregar medio de pago</button>}
      <Alert msg={msg} />
      {form && (
        <form onSubmit={save} className="card grid gap-3 md:grid-cols-3">
          <Field label="Tipo">
            <select className="input" value={form.type} disabled={!!form.id} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
              {opts(PM_TYPES).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Nombre visible"><input className="input" required value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="Banco Nación" /></Field>
          {fieldsOf(form.type).map(([k, label]) => (
            <Field key={k} label={label}><input className="input" value={form[k] || ''} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} /></Field>
          ))}
          <div className="flex justify-end gap-2 md:col-span-3">
            <button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancelar</button>
            <button className="btn-primary">Guardar</button>
          </div>
        </form>
      )}
      <ul className="grid gap-3 md:grid-cols-2">
        {(list.data?.methods || []).map((m) => {
          const d = typeof m.data === 'string' ? JSON.parse(m.data) : m.data;
          return (
            <li key={m.id} className={`card space-y-1 ${m.active ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-2">
                <div><div className="text-xs font-semibold uppercase text-slate-500">{PM_TYPES[m.type]}</div><div className="font-medium">{m.label}</div></div>
                <span className="flex gap-1">
                  <button type="button" className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" onClick={() => edit(m)}>Datos</button>
                  {crud.actions(m)}
                </span>
              </div>
              <p className="text-xs text-slate-500">{Object.values(d).filter(Boolean).join(' · ') || 'Sin datos'}</p>
            </li>
          );
        })}
      </ul>
      {crud.ui}
    </div>
  );
}

// ============================== Configuración + MercadoPago (OAuth) ==============================
export function ExpenseConfig() {
  const cfg = useFetch('/expense-config');
  const mp = useFetch('/pagos/oauth/status');
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(() => {
    const p = new URLSearchParams(location.search).get('mp');
    return p === 'ok' ? { ok: '✅ Mercado Pago vinculado correctamente.' } : p === 'error' ? { error: 'No se pudo vincular Mercado Pago. Probá de nuevo.' } : {};
  });
  const values = form ?? cfg.data ?? {};
  const set = (k) => (e) => setForm({ ...values, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    const { legal_name, cuit, address, email, phone, display_name } = values;
    try { await api.put('/expense-config', { legal_name, cuit, address, email, phone, display_name }); setMsg({ ok: 'Datos guardados' }); setForm(null); cfg.reload(); } catch (err) { setMsg({ error: errMsg(err) }); }
  };
  const connect = async () => {
    try { const { data } = await api.get('/pagos/oauth/url?return=/expensas'); window.location.href = data.url; } catch (err) { setMsg({ error: errMsg(err) }); }
  };
  const disconnect = async () => {
    if (!confirm('¿Desvincular la cuenta de Mercado Pago? Los propietarios no podrán pagar online hasta volver a vincularla.')) { return; }
    try { await api.delete('/pagos/oauth'); mp.reload(); setMsg({ ok: 'Mercado Pago desvinculado' }); } catch (err) { setMsg({ error: errMsg(err) }); }
  };
  return (
    <div className="space-y-4">
      <Alert msg={msg.error} />
      <Alert msg={msg.ok} type="ok" />
      <section className="card space-y-3" aria-labelledby="mp-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="mp-title" className="font-semibold">Cobro online con Mercado Pago</h2>
            <p className="text-sm text-slate-500">Conexión segura por OAuth: autorizás en Mercado Pago y los pagos se acreditan automáticamente en tu cuenta. El sistema nunca ve tu contraseña.</p>
          </div>
          <span className={`badge ${mp.data?.linked ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{mp.data?.linked ? 'Vinculado' : 'No vinculado'}</span>
        </div>
        {mp.data && !mp.data.configured && <p className="text-sm text-amber-700 dark:text-amber-300">El servidor todavía no tiene configuradas las credenciales de la aplicación (MP_CLIENT_ID, MP_CLIENT_SECRET, PUBLIC_API_URL).</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={connect} disabled={!mp.data?.configured}>{mp.data?.linked ? 'Reconectar cuenta' : 'Conectar con Mercado Pago'}</button>
          {mp.data?.linked && <button type="button" className="btn-secondary" onClick={disconnect}>Desvincular</button>}
        </div>
      </section>

      <form onSubmit={save} className="card grid gap-3 md:grid-cols-2">
        <h2 className="font-semibold md:col-span-2">Datos del complejo (encabezado de reportes y recibos)</h2>
        <Field label="Nombre"><input className="input" value={values.display_name || ''} onChange={set('display_name')} placeholder={cfg.data?.name} /></Field>
        <Field label="Razón social"><input className="input" value={values.legal_name || ''} onChange={set('legal_name')} /></Field>
        <Field label="CUIT"><input className="input" value={values.cuit || ''} onChange={set('cuit')} placeholder="30-12345678-9" /></Field>
        <Field label="Domicilio"><input className="input" value={values.address || ''} onChange={set('address')} /></Field>
        <Field label="Email"><input className="input" type="email" value={values.email || ''} onChange={set('email')} /></Field>
        <Field label="Teléfono"><input className="input" value={values.phone || ''} onChange={set('phone')} /></Field>
        <div className="flex items-center gap-3 md:col-span-2">
          {cfg.data?.logo_url ? <img src={cfg.data.logo_url} alt="Logo del complejo" className="h-12 w-12 rounded-lg bg-white object-contain p-1" /> : null}
          <p className="text-xs text-slate-500">El logo se administra en <a href="/branding" className="underline">Identidad y galería</a>.</p>
          <button className="btn-primary ml-auto">Guardar</button>
        </div>
      </form>
    </div>
  );
}
