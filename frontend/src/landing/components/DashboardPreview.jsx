import { useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import { AreaChart, Bars, Ring } from '../../components/Charts';

// Datos simulados del preview
const TABS = [
  { id: 'resumen', label: 'Resumen', icon: 'chart' },
  { id: 'accesos', label: 'Accesos', icon: 'gate' },
  { id: 'reservas', label: 'Reservas', icon: 'calendar' },
  { id: 'alertas', label: 'Alertas', icon: 'bell' },
];
const KPIS = [
  ['Residentes activos', '2.418', '+3,2%', 'users'], ['Visitantes hoy', '142', '+18', 'qr'],
  ['Expensas cobradas', '91%', '+4 pts', 'wallet'], ['Reservas semana', '57', '+9', 'calendar'],
];
const ACCESOS = [
  ['08:42', 'Juan Pérez', 'Visita', 'Lote 214', 'Adentro'], ['08:57', 'Envíos Rápidos', 'Delivery', 'Lote 87', 'Salió'],
  ['09:10', 'Marta Gómez', 'Servicio', 'Lote 132', 'Adentro'], ['09:26', 'Carlos Ruiz', 'Visita', 'Lote 45', 'Pendiente'],
  ['09:31', 'Obra Lote 301', 'Obrero', 'Lote 301', 'Adentro'],
];
const RESERVAS = [
  ['Tenis 1', '18:00', 'Lote 214', 'Aprobada'], ['Club House', '20:30', 'Lote 87', 'Pendiente'],
  ['Pádel 2', '19:00', 'Lote 45', 'Aprobada'], ['Quincho Norte', '13:00', 'Lote 132', 'Pagada'],
];
const ALERTAS = [
  ['critical', 'Emergencia médica', 'Lote 214 · tomada por Guardia 2', 'hace 4 min'],
  ['warn', 'Ronda incompleta', 'Faltó el punto "Portón norte"', 'hace 22 min'],
  ['info', 'Visita esperando', 'Carlos Ruiz en guardia, Lote 45', 'hace 1 min'],
];
const TONE = {
  Adentro: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', Salió: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
  Pendiente: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', Aprobada: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  Pagada: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
};
const ALERT_TONE = { critical: 'bg-red-500', warn: 'bg-amber-500', info: 'bg-sky-500' };

function Panel({ tab }) {
  if (tab === 'accesos') {
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead><tr className="text-xs uppercase text-slate-500 dark:text-slate-400">{['Hora', 'Visitante', 'Tipo', 'Destino', 'Estado'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {ACCESOS.map((r) => (
              <tr key={r[0]} className="border-t border-slate-200/70 dark:border-white/5">
                <td className="px-3 py-2.5 tabular-nums text-slate-500">{r[0]}</td><td className="px-3 py-2.5 font-medium text-slate-900 dark:text-white">{r[1]}</td>
                <td className="px-3 py-2.5">{r[2]}</td><td className="px-3 py-2.5">{r[3]}</td>
                <td className="px-3 py-2.5"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[r[4]]}`}>{r[4]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (tab === 'reservas') {
    return (
      <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
        <div className="rounded-xl bg-white/70 p-4 dark:bg-white/5">
          <p className="mb-3 text-sm font-medium">Ocupación por día</p>
          <div className="h-40"><Bars data={[12, 18, 15, 22, 28, 35, 31]} labels={['L', 'M', 'M', 'J', 'V', 'S', 'D']} /></div>
        </div>
        <ul className="space-y-2">
          {RESERVAS.map((r) => (
            <li key={r[0]} className="flex items-center justify-between rounded-xl bg-white/70 px-4 py-3 text-sm dark:bg-white/5">
              <span><span className="font-medium text-slate-900 dark:text-white">{r[0]}</span><span className="ml-2 text-slate-500">{r[1]} · {r[2]}</span></span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[r[3]]}`}>{r[3]}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (tab === 'alertas') {
    return (
      <ul className="space-y-2">
        {ALERTAS.map((a) => (
          <li key={a[1]} className="flex items-start gap-3 rounded-xl bg-white/70 p-4 dark:bg-white/5">
            <span className="relative mt-1.5 flex h-2.5 w-2.5">
              {a[0] === 'critical' && <span className="absolute inset-0 animate-pulse-ring rounded-full bg-red-500" />}
              <span className={`relative h-2.5 w-2.5 rounded-full ${ALERT_TONE[a[0]]}`} />
            </span>
            <span className="flex-1"><span className="block font-medium text-slate-900 dark:text-white">{a[1]}</span><span className="text-sm text-slate-500 dark:text-slate-400">{a[2]}</span></span>
            <span className="whitespace-nowrap text-xs text-slate-400">{a[3]}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KPIS.map(([l, v, d, ic]) => (
          <div key={l} className="rounded-xl bg-white/70 p-4 dark:bg-white/5">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400"><span className="text-xs">{l}</span><Icon name={ic} className="h-4 w-4" /></div>
            <div className="mt-2 font-display text-2xl font-bold text-slate-900 dark:text-white">{v}</div>
            <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{d}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-xl bg-white/70 p-4 dark:bg-white/5">
          <div className="mb-2 flex justify-between text-sm"><span className="font-medium">Accesos registrados</span><span className="text-slate-500">30 días</span></div>
          <AreaChart id="preview" className="h-40 w-full" data={[180, 210, 190, 260, 240, 300, 280, 320, 310, 360, 340, 390, 370, 420, 400, 450, 430, 470, 460, 500]} />
        </div>
        <div className="flex flex-col justify-around gap-3 rounded-xl bg-white/70 p-4 dark:bg-white/5">
          <div className="flex items-center gap-3"><Ring value={91} label="Expensas al día" /><span className="text-sm">Expensas al día</span></div>
          <div className="flex items-center gap-3"><Ring value={98} label="Rondas completas" /><span className="text-sm">Rondas completas</span></div>
        </div>
      </div>
    </div>
  );
}

/** Preview interactivo del panel (tabs con indicador recortado por clip-path). */
export function DashboardPreview() {
  const [tab, setTab] = useState('resumen');
  const tabsRef = useRef([]);

  const onKey = (e, i) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) { return; }
    const next = (i + d + TABS.length) % TABS.length;
    setTab(TABS[next].id);
    tabsRef.current[next]?.focus();
  };

  return (
    <div className="glass overflow-hidden rounded-3xl text-slate-700 dark:text-slate-300">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 px-4 py-3 dark:border-white/10 sm:px-6">
        <div role="tablist" aria-label="Secciones del panel" className="no-scrollbar flex gap-1 overflow-x-auto">
          {TABS.map((t, i) => (
            <button key={t.id} ref={(el) => (tabsRef.current[i] = el)} type="button" role="tab" id={`tab-${t.id}`} aria-controls="preview-panel"
              aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)} onKeyDown={(e) => onKey(e, i)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-[background-color,color] duration-200 ease-out ${
                tab === t.id ? 'bg-brand-600 text-brand-on shadow' : 'hover:bg-slate-900/5 dark:hover:bg-white/5'}`}>
              <Icon name={t.icon} className="h-4 w-4" />{t.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500 dark:text-slate-400">Datos de ejemplo</span>
      </div>
      <div id="preview-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="min-h-[340px] p-4 sm:p-6">
        <div key={tab} className="animate-[fadeUp_400ms_cubic-bezier(0.23,1,0.32,1)_both]"><Panel tab={tab} /></div>
      </div>
    </div>
  );
}
