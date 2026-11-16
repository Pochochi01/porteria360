import { useState } from 'react';
import { api, errMsg } from '../../lib/api';
import { Alert, Status } from '../../components/ui';
import { fmtDate, money } from '../../lib/format';
import { useFetch } from '../../hooks/useFetch';
import { useCrud } from '../../hooks/useCrud';

/** Liquidaciones (administración): importar Excel, efectivo, revisar transferencias y pagos. */
export default function Settlements({ reloadKey }) {
  const list = useFetch(`/expenses?k=${reloadKey ?? 0}`);
  const [msg, setMsg] = useState({});
  const lots = useFetch('/lots');
  const crud = useCrud({
    path: '/expenses', label: 'liquidación', onChange: list.reload, canEdit: true,
    fields: (s) => [
      ...(s.status === 'pending' ? [
        { name: 'lot_id', label: 'Lote', type: 'select', required: true, numeric: true,
          options: (Array.isArray(lots.data) ? lots.data : []).map((l) => ({ value: String(l.id), label: l.code })) },
        { name: 'period', label: 'Periodo (AAAA-MM)', required: true },
        { name: 'amount', label: 'Importe', type: 'number', step: '0.01', required: true },
      ] : []),
      { name: 'due_date', label: 'Vencimiento', type: 'date', required: true },
      { name: 'detail', label: 'Detalle', type: 'textarea' },
    ],
  });

  const run = async (fn, ok) => {
    try { await fn(); setMsg({ ok }); list.reload(); } catch (err) { setMsg({ error: errMsg(err), details: err.response?.data?.errors }); }
  };

  const importExcel = (e) => {
    const f = e.target.files[0];
    if (!f) { return; }
    const fd = new FormData();
    fd.append('file', f);
    run(async () => { const { data } = await api.post('/expenses/import', fd); setMsg({ ok: `${data.imported} liquidaciones importadas` }); }, undefined);
    e.target.value = '';
  };

  const cash = (s) => {
    if (!confirm(`Registrar pago en efectivo de ${money(s.amount)} para lote ${s.lot_code}?`)) { return; }
    run(() => api.post(`/expenses/${s.id}/cash`, { amount: Number(s.amount) }), 'Pago en efectivo registrado');
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <label className="btn-primary cursor-pointer">Importar Excel<input type="file" accept=".xlsx,.xls,.csv" hidden onChange={importExcel} /></label>
      </div>
      <Alert msg={msg.error} />
      {msg.details && <ul className="mb-3 list-disc pl-6 text-xs text-red-700">{msg.details.map((d) => <li key={d.fila}>Fila {d.fila}: {d.error}</li>)}</ul>}
      <Alert msg={msg.ok} type="ok" />
      <p className="text-xs text-slate-500">Formato: columnas <code>lote | periodo (AAAA-MM) | importe | vencimiento (AAAA-MM-DD) | detalle</code></p>
      <PendingTransfers onChange={list.reload} />

      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Lote</th><th>Periodo</th><th>Vence</th><th>Importe</th><th>Estado</th><th>Recibo</th><th /></tr></thead>
          <tbody>
            {list.data?.map((s) => (
              <tr key={s.id}>
                <td>{s.lot_code}</td>
                <td>{s.period}</td><td>{s.due_date}</td><td>{money(s.amount)}</td><td><Status s={s.status} /></td>
                <td>{s.receipt_number || '—'}</td>
                <td>
                  {s.status === 'pending' && <button className="btn-secondary" onClick={() => cash(s)}>Efectivo</button>}
                  <span className="ml-1">{crud.actions(s)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PaymentsHistory key={list.data?.length} onChange={list.reload} />
      {crud.ui}
    </div>
  );
}

const METHOD = { transfer: 'Transferencia', cash: 'Efectivo', mercadopago: 'Mercado Pago' };

function PaymentsHistory({ onChange }) {
  const p = useFetch('/expenses/payments');
  const crud = useCrud({
    path: '/expenses/payments', label: 'pago', onChange: () => { p.reload(); onChange(); },
    fields: [
      { name: 'method', label: 'Medio', type: 'select', required: true, options: Object.entries(METHOD).map(([value, label]) => ({ value, label })) },
      { name: 'receipt_number', label: 'N° de recibo' },
    ],
  });
  if (!p.data?.length) { return null; }
  return (
    <div className="card overflow-x-auto">
      <h2 className="mb-2 font-semibold">Pagos registrados</h2>
      <table className="table">
        <thead><tr><th>Fecha</th><th>Lote</th><th>Periodo</th><th>Medio</th><th>Importe</th><th>Estado</th><th>Recibo</th><th /></tr></thead>
        <tbody>
          {p.data.map((x) => (
            <tr key={x.id}>
              <td>{fmtDate(x.created_at)}</td><td>{x.lot_code}</td><td>{x.period}</td><td>{METHOD[x.method]}</td>
              <td>{money(x.amount)}</td><td><Status s={x.status} /></td><td>{x.receipt_number || '—'}</td>
              <td className="text-right">{crud.actions(x)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {crud.ui}
    </div>
  );
}

function PendingTransfers({ onChange }) {
  const p = useFetch('/expenses/payments');
  const pending = p.data?.filter((x) => x.status === 'pending') || [];
  const review = async (x, approve) => {
    await api.post(`/expenses/payments/${x.id}/review`, { approve });
    p.reload();
    onChange();
  };
  const view = async (x) => {
    const r = await api.get(`/expenses/payments/${x.id}/receipt-file`, { responseType: 'blob' });
    window.open(URL.createObjectURL(r.data));
  };
  if (!pending.length) { return null; }
  return (
    <div className="card">
      <h2 className="mb-2 font-semibold">Transferencias a revisar ({pending.length})</h2>
      {pending.map((x) => (
        <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm">
          <span>Lote {x.lot_code} · {x.period} · {money(x.amount)}</span>
          <span className="flex gap-2">
            <button className="btn-secondary" onClick={() => view(x)}>Ver comprobante</button>
            <button className="btn-primary" onClick={() => review(x, true)}>Aprobar</button>
            <button className="btn-danger" onClick={() => review(x, false)}>Rechazar</button>
          </span>
        </div>
      ))}
    </div>
  );
}
