import { pieColor } from '../lib/chartColors';

// Gráficos SVG livianos para el mockup y el preview del panel (datos simulados).

/** @param {{ data: number[], className?: string, id: string }} props */
export function AreaChart({ data, className = '', id }) {
  const w = 300, h = 100, max = Math.max(...data) * 1.15;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - (v / max) * h]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`area-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--brand-500))" stopOpacity="0.35" />
          <stop offset="100%" stopColor="rgb(var(--brand-500))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#area-${id})`} />
      <path d={line} fill="none" stroke="rgb(var(--brand-500))" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** @param {{ data: number[], labels?: string[], className?: string }} props */
export function Bars({ data, labels, className = '' }) {
  const max = Math.max(...data);
  return (
    <div className={`flex h-full items-end gap-1.5 ${className}`} aria-hidden="true">
      {data.map((v, i) => (
        // eslint-disable-next-line react/no-array-index-key -- serie posicional fija: el índice ES la identidad (día/mes), nunca se reordena
        <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
          <div className="w-full origin-bottom rounded-t bg-brand-500/80 dark:bg-brand-400/80" style={{ height: `${(v / max) * 100}%` }} />
          {labels && <span className="text-[10px] text-slate-400">{labels[i]}</span>}
        </div>
      ))}
    </div>
  );
}

/** Anillo de progreso. @param {{ value: number, label: string }} props */
export function Ring({ value, label }) {
  const r = 26, c = 2 * Math.PI * r;
  return (
    <div className="relative grid h-16 w-16 place-items-center" role="img" aria-label={`${label}: ${value}%`}>
      <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-slate-200 dark:stroke-slate-700" />
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" strokeLinecap="round" stroke="rgb(var(--brand-500))"
          strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} />
      </svg>
      <span className="text-sm font-bold text-slate-900 dark:text-white">{value}%</span>
    </div>
  );
}


/**
 * Gráfico de torta (dona) en SVG, sin librerías.
 * @param {{ data: { label: string, value: number }[], size?: number, active?: number | null,
 *           onSelect?: (index: number) => void, center?: import('react').ReactNode }} props
 */
export function Pie({ data, size = 220, active = null, onSelect, center }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const r = 80, stroke = 34, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90" role="img"
        aria-label={data.map((d) => `${d.label} ${total ? (Math.round((d.value / total) * 1000) / 10).toLocaleString('es-AR') : 0}%`).join(', ')}>
        {total === 0 && <circle cx="100" cy="100" r={r} fill="none" strokeWidth={stroke} className="stroke-slate-200 dark:stroke-slate-700" />}
        {data.map((d, i) => {
          const len = total ? (d.value / total) * c : 0;
          const seg = (
            <circle key={d.label} cx="100" cy="100" r={r} fill="none" stroke={pieColor(i)}
              strokeWidth={active === i ? stroke + 8 : stroke} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset}
              className={`transition-[stroke-width,opacity] duration-200 ease-out ${onSelect ? 'cursor-pointer' : ''} ${active != null && active !== i ? 'opacity-40' : ''}`}
              onClick={onSelect ? () => onSelect(i) : undefined} />
          );
          offset += len;
          return seg;
        })}
      </svg>
      {center && <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">{center}</div>}
    </div>
  );
}
