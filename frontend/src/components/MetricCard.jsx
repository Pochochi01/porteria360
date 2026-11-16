/**
 * Indicador numérico para dashboards.
 * @param {{ label: string, value: import('react').ReactNode, hint?: import('react').ReactNode, tone?: 'default' | 'good' | 'bad' | 'warn' }} props
 */
export function MetricCard({ label, value, hint, tone = 'default' }) {
  const color = { default: 'text-slate-900 dark:text-white', good: 'text-emerald-600 dark:text-emerald-400', bad: 'text-red-600 dark:text-red-400', warn: 'text-amber-600 dark:text-amber-400' }[tone];
  return (
    <div className="card min-w-0">
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-1 font-display text-xl font-bold leading-tight tabular-nums [overflow-wrap:anywhere] 2xl:text-2xl ${color}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</div>}
    </div>
  );
}
