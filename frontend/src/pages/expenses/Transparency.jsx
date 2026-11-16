import { useState } from 'react';
import { useFetch } from '../../hooks/useFetch';
import { fmtDay, fmtPct, money } from '../../lib/format';
import { pieColor } from '../../lib/chartColors';
import { downloadFile } from '../../lib/download';
import { errMsg } from '../../lib/api';
import { Pie } from '../../components/Charts';
import { Alert } from '../../components/ui';
import { Icon } from '../../components/icons';
import { DocumentViewer } from '../../components/DocumentViewer';

/** Selector de período (usa los períodos con gastos o expensas; si no hay, el mes actual). */
export function PeriodSelect({ value, onChange }) {
  const periods = useFetch('/expenditures/periods');
  const list = periods.data?.length ? periods.data : [value];
  const options = list.includes(value) ? list : [value, ...list];
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-slate-500">Período</span>
      <select className="input w-auto" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((p) => <option key={p} value={p}>{p.split('-').reverse().join('/')}</option>)}
      </select>
    </label>
  );
}

/** "Gastos del Período": total, torta por rubro y detalle desplegable con comprobantes. Lo usan admin y propietarios. */
export default function Transparency({ period, onPeriod }) {
  const { data, error } = useFetch(`/expenditures/summary?period=${period}`);
  const [open, setOpen] = useState(null);
  const [voucher, setVoucher] = useState(null);
  const [msg, setMsg] = useState('');

  const exportAs = async (format) => {
    setMsg('');
    try { await downloadFile(`/expense-reports/expenditures?period=${period}&format=${format}`, `gastos-${period}.${format}`); } catch (e) { setMsg(errMsg(e)); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodSelect value={period} onChange={onPeriod} />
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => exportAs('pdf')}><Icon name="file" className="h-4 w-4" />PDF</button>
          <button type="button" className="btn-secondary" onClick={() => exportAs('xlsx')}><Icon name="grid" className="h-4 w-4" />Excel</button>
        </div>
      </div>
      <Alert msg={error || msg} />

      {data && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
          <div className="card flex flex-col items-center gap-4">
            <div className="text-center">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total general</div>
              <div className="font-display text-3xl font-extrabold tabular-nums text-slate-900 dark:text-white">{money(data.total)}</div>
              <div className="text-xs text-slate-500">{data.count} comprobante{data.count === 1 ? '' : 's'}</div>
            </div>
            <Pie data={data.categories.map((c) => ({ label: c.name, value: c.total }))} active={open}
              onSelect={(i) => setOpen((o) => (o === i ? null : i))}
              center={open != null && data.categories[open]
                ? <span><span className="block text-xs text-slate-500">{data.categories[open].name}</span><span className="font-bold">{fmtPct(data.categories[open].pct)}</span></span>
                : null} />
            {!data.categories.length && <p className="text-sm text-slate-500">No hay gastos cargados en este período.</p>}
          </div>

          <ul className="space-y-2">
            {data.categories.map((c, i) => (
              <li key={c.id} className="card p-0">
                <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}
                  className="flex w-full items-center gap-3 p-4 text-left">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: pieColor(i) }} />
                  <span className="flex-1 font-semibold uppercase tracking-wide">{c.name}</span>
                  <span className="text-right">
                    <span className="block font-semibold tabular-nums">{money(c.total)}</span>
                    <span className="text-xs text-slate-500">{fmtPct(c.pct)}</span>
                  </span>
                  <Icon name={open === i ? 'up' : 'down'} className="h-4 w-4 text-slate-400" />
                </button>
                {open === i && (
                  <ul className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
                    {c.items.map((it) => (
                      <li key={it.id} className="grid gap-x-4 gap-y-1 px-4 py-3 text-sm sm:grid-cols-[1fr_auto]">
                        <div>
                          <div className="font-medium">{it.concept}</div>
                          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-xs text-slate-500 dark:text-slate-400">
                            {it.supplier && <><dt>Proveedor:</dt><dd>{it.supplier}</dd></>}
                            {it.voucher && <><dt>Comprobante:</dt><dd>{it.voucher}</dd></>}
                            <dt>Fecha:</dt><dd>{fmtDay(it.date)}</dd>
                          </dl>
                        </div>
                        <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-center">
                          <span className="font-semibold tabular-nums">{money(it.amount)}</span>
                          {it.has_voucher && (
                            <button type="button" className="btn-secondary px-3 py-1.5 text-xs"
                              onClick={() => setVoucher({ id: it.id, title: it.voucher || it.concept })}>
                              <Icon name="file" className="h-3.5 w-3.5" />Ver comprobante
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {voucher && (
        <DocumentViewer url={`/expenditures/${voucher.id}/voucher`} title={voucher.title}
          filename={`comprobante-${voucher.id}`} onClose={() => setVoucher(null)} />
      )}
    </div>
  );
}
