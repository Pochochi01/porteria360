import { useState } from 'react';
import { api, errMsg } from '../../lib/api';
import { useAuth, useSocketEvent } from '../../lib/auth';
import { useFetch } from '../../hooks/useFetch';
import { fmtDate, fmtDay, money } from '../../lib/format';
import { Alert, Status } from '../../components/ui';
import { Icon } from '../../components/icons';
import { MetricCard } from '../../components/MetricCard';

const STATUS_LABEL = { up_to_date: 'Al día', pending: 'Pendiente de pago', overdue: 'Con deuda vencida' };
const METHOD = { transfer: 'Transferencia', cash: 'Efectivo', mercadopago: 'Mercado Pago' };
const PAY_LABEL = { transfer: 'Transferencia bancaria', mercadopago: 'Mercado Pago', modo: 'MODO', naranjax: 'Naranja X' };

/** Datos para pagar: CBU/alias, QR o link de billeteras (configurados por la administración). */
function PaymentMethods({ data }) {
  const [copied, setCopied] = useState('');
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied(''), 1500); } catch { /* sin permiso de portapapeles */ }
  };
  if (!data?.methods.length) { return null; }
  return (
    <section className="card space-y-3" aria-labelledby="pm-title">
      <h2 id="pm-title" className="font-semibold">Medios de pago</h2>
      <ul className="grid gap-3 md:grid-cols-2">
        {data.methods.map((m) => {
          const d = typeof m.data === 'string' ? JSON.parse(m.data) : m.data;
          const rows = [['Alias', d.alias], ['CBU/CVU', d.cbu], ['Banco', d.bank], ['Titular', d.holder], ['CUIT', d.cuit]].filter(([, v]) => v);
          return (
            <li key={m.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{PAY_LABEL[m.type]}</div>
              <div className="font-medium">{m.label}</div>
              <dl className="mt-2 space-y-1 text-sm">
                {rows.map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-2">
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="flex items-center gap-1 font-mono">{v}
                      <button type="button" onClick={() => copy(v)} aria-label={`Copiar ${k}`} className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                        <Icon name={copied === v ? 'check' : 'file'} className="h-3.5 w-3.5" />
                      </button>
                    </dd>
                  </div>
                ))}
              </dl>
              {d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" className="btn-secondary mt-2 w-full"><Icon name="external" className="h-4 w-4" />Pagar con {PAY_LABEL[m.type]}</a>}
              {d.qr_text && <p className="mt-2 break-all rounded bg-slate-50 p-2 text-xs dark:bg-slate-800">QR: {d.qr_text}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Mi cuenta: indicadores, expensas a pagar (transferencia o Mercado Pago) y medios de pago. */
export function OwnerAccount({ onPaid }) {
  const { is } = useAuth();
  const owner = is('owner'); // los familiares ven, no pagan
  const summary = useFetch('/owner/summary');
  const list = useFetch('/expenses');
  const methods = useFetch('/payment-methods');
  const [paying, setPaying] = useState(null);
  const [file, setFile] = useState(null);
  const [msg, setMsg] = useState(() => {
    const p = new URLSearchParams(location.search).get('pago');
    return p === 'ok' ? { ok: '✅ Pago recibido. Se acredita automáticamente en unos instantes.' } : p === 'error' ? { error: 'El pago no se completó.' } : {};
  });
  const reload = () => { summary.reload(); list.reload(); onPaid?.(); };
  useSocketEvent('expenses:updated', reload);

  const sendTransfer = async (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('amount', paying.amount); // el importe no es editable: sin pagos parciales
    fd.append('receipt', file);
    try {
      await api.post(`/expenses/${paying.id}/transfer`, fd);
      setPaying(null);
      setMsg({ ok: 'Comprobante enviado. Queda en revisión de la administración.' });
      reload();
    } catch (err) { setMsg({ error: errMsg(err) }); }
  };
  const payMp = async (s) => {
    try {
      const { data } = await api.post(`/pagos/expenses/${s.id}/preference`);
      window.location.href = data.init_point;
    } catch (err) { setMsg({ error: errMsg(err) }); }
  };

  const s = summary.data;
  const pending = list.data?.filter((x) => x.status === 'pending') || [];
  return (
    <div className="space-y-4">
      <Alert msg={msg.error || summary.error} />
      <Alert msg={msg.ok} type="ok" />
      {s && (
        <>
          {s.lots.length > 1 && <p className="text-sm text-slate-500">Lotes: {s.lots.map((l) => l.code).join(' · ')}</p>}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
            <MetricCard label={`Expensa actual${s.current.period ? ` (${s.current.period})` : ''}`} value={money(s.current.amount)} hint={s.current.paid ? 'Pagada' : undefined} tone={s.current.paid ? 'good' : 'default'} />
            <MetricCard label="Deuda acumulada" value={money(s.debt)} tone={s.debt ? 'bad' : 'good'} hint="Períodos anteriores impagos" />
            <MetricCard label="Total a pagar" value={money(s.total_to_pay)} tone={s.total_to_pay ? 'warn' : 'good'} hint={s.in_review ? `${money(s.in_review)} en revisión` : undefined} />
            <MetricCard label="Próximo vencimiento" value={s.next_due ? fmtDay(s.next_due.date) : '—'} hint={s.next_due ? `${s.next_due.period} · ${money(s.next_due.amount)}` : 'Sin vencimientos'} />
            <MetricCard label="Estado de cuenta" value={STATUS_LABEL[s.status]} tone={{ up_to_date: 'good', pending: 'warn', overdue: 'bad' }[s.status]} />
          </div>
        </>
      )}

      {paying && (
        <form onSubmit={sendTransfer} className="card space-y-3 border-2 border-brand-600">
          <h2 className="font-semibold">Informar transferencia · {paying.period} · Lote {paying.lot_code}</h2>
          <p className="text-sm">Importe a transferir: <b>{money(paying.amount)}</b> <span className="text-xs text-slate-500">(no se aceptan pagos parciales)</span></p>
          <input type="file" accept="image/*,application/pdf" required onChange={(e) => setFile(e.target.files[0])} className="text-sm" />
          <div className="flex flex-wrap gap-2"><button className="btn-primary">Enviar comprobante</button><button type="button" className="btn-secondary" onClick={() => setPaying(null)}>Cancelar</button></div>
        </form>
      )}

      <section className="card overflow-x-auto" aria-labelledby="topay-title">
        <h2 id="topay-title" className="mb-2 font-semibold">Expensas a pagar</h2>
        {pending.length ? (
          <table className="table">
            <thead><tr><th>Lote</th><th>Período</th><th>Vence</th><th className="text-right">Importe</th><th /></tr></thead>
            <tbody>
              {pending.map((x) => (
                <tr key={x.id}>
                  <td>{x.lot_code}</td><td>{x.period}</td><td>{fmtDay(x.due_date)}</td><td className="text-right tabular-nums">{money(x.amount)}</td>
                  <td className="whitespace-nowrap text-right">
                    {owner && <>
                      {methods.data?.mercadopago_checkout && <button className="btn-primary mr-1" onClick={() => payMp(x)}>Pagar con Mercado Pago</button>}
                      <button className="btn-secondary" onClick={() => setPaying(x)}>Informar transferencia</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-sm text-slate-500">No tenés expensas pendientes. 🎉</p>}
      </section>
      <PaymentMethods data={methods.data} />
    </div>
  );
}

/** Paginador simple: sin total, "siguiente" se habilita si la página vino llena. */
function Pager({ page, set, rows, limit }) {
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-sm">
      <button type="button" className="btn-secondary px-2 py-1" disabled={page <= 1} onClick={() => set(page - 1)} aria-label="Página anterior"><Icon name="chevronLeft" className="h-4 w-4" /></button>
      <span>Página {page}</span>
      <button type="button" className="btn-secondary px-2 py-1" disabled={(rows?.length ?? 0) < limit} onClick={() => set(page + 1)} aria-label="Página siguiente"><Icon name="chevronRight" className="h-4 w-4" /></button>
    </div>
  );
}

/** Historial de expensas y de pagos (paginado). */
export function OwnerHistory() {
  const [pageS, setPageS] = useState(1);
  const [pageP, setPageP] = useState(1);
  const settlements = useFetch(`/owner/settlements?page=${pageS}`);
  const payments = useFetch(`/owner/payments?page=${pageP}`);
  const viewReceipt = async (p) => {
    const r = await api.get(`/expenses/payments/${p.id}/receipt-file`, { responseType: 'blob' });
    window.open(URL.createObjectURL(r.data));
  };
  return (
    <div className="space-y-4">
      <section className="card overflow-x-auto" aria-labelledby="hist-exp">
        <h2 id="hist-exp" className="mb-2 font-semibold">Historial de expensas</h2>
        <table className="table">
          <thead><tr><th>Período</th><th>Lote</th><th className="text-right">Importe</th><th>Estado</th><th>Vencimiento</th><th className="text-right">Saldo</th><th>Recibo</th></tr></thead>
          <tbody>
            {settlements.data?.rows.map((x) => (
              <tr key={x.id}>
                <td>{x.period}</td><td>{x.lot_code}</td><td className="text-right tabular-nums">{money(x.amount)}</td><td><Status s={x.status} /></td>
                <td>{fmtDay(x.due_date)}</td><td className="text-right tabular-nums">{money(x.balance)}</td><td>{x.receipt_number || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {settlements.data && <Pager page={pageS} set={setPageS} rows={settlements.data.rows} limit={settlements.data.limit} />}
      </section>
      <section className="card overflow-x-auto" aria-labelledby="hist-pay">
        <h2 id="hist-pay" className="mb-2 font-semibold">Historial de pagos</h2>
        <table className="table">
          <thead><tr><th>Fecha</th><th>Período</th><th className="text-right">Importe</th><th>Método</th><th>Comprobante</th><th>Estado</th></tr></thead>
          <tbody>
            {payments.data?.rows.map((p) => (
              <tr key={p.id}>
                <td>{fmtDate(p.created_at)}</td><td>{p.period} · {p.lot_code}</td><td className="text-right tabular-nums">{money(p.amount)}</td><td>{METHOD[p.method]}</td>
                <td>{p.receipt_number || (p.has_file ? <button type="button" className="text-brand-700 underline dark:text-brand-400" onClick={() => viewReceipt(p)}>Ver</button> : '—')}</td>
                <td><Status s={p.status} /></td>
              </tr>
            ))}
            {payments.data?.rows.length === 0 && <tr><td colSpan={6} className="text-slate-500">Sin pagos registrados.</td></tr>}
          </tbody>
        </table>
        {payments.data && <Pager page={pageP} set={setPageP} rows={payments.data.rows} limit={payments.data.limit} />}
      </section>
    </div>
  );
}
