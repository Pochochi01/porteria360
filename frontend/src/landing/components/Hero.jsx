import { useRef } from 'react';
import { useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { Icon } from '../../components/icons';
import { useFinePointer } from '../../hooks/useMediaQuery';
import { HERO } from '../data/content';
import { AreaChart, Bars } from '../../components/Charts';
import { Scene } from './Scene';


/** Mockup del panel dentro del Hero (datos simulados). */
function DashboardMockup() {
  return (
    <div className="glass overflow-hidden rounded-2xl">
      <div className="flex items-center gap-2 border-b border-slate-200/70 px-4 py-3 dark:border-white/10">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" /><span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
        <span className="ml-3 rounded-md bg-slate-900/5 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-white/5 dark:text-slate-400">panel · Country Los Álamos</span>
      </div>
      <div className="grid grid-cols-[110px_1fr] text-left">
        <div className="hidden space-y-1 border-r border-slate-200/70 p-3 sm:block dark:border-white/10">
          {['Resumen', 'Accesos', 'Expensas', 'Reservas', 'Rondas', 'Emergencias'].map((t, i) => (
            <div key={t} className={`rounded-md px-2 py-1.5 text-[11px] ${i === 0 ? 'bg-brand-600/10 font-semibold text-brand-800 dark:bg-brand-400/15 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400'}`}>{t}</div>
          ))}
        </div>
        <div className="col-span-2 space-y-3 p-3 sm:col-span-1 sm:p-4">
          <div className="grid grid-cols-3 gap-2">
            {[['Ingresos hoy', '386', '+12%'], ['Expensas al día', '91%', '+4%'], ['Reservas', '57', '+8']].map(([l, v, d]) => (
              <div key={l} className="rounded-lg bg-white/70 p-2.5 dark:bg-white/5">
                <div className="text-[10px] text-slate-500 dark:text-slate-400">{l}</div>
                <div className="font-display text-lg font-bold text-slate-900 dark:text-white">{v}</div>
                <div className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">{d}</div>
              </div>
            ))}
          </div>
          <div className="rounded-lg bg-white/70 p-3 dark:bg-white/5">
            <div className="mb-1 flex justify-between text-[11px] text-slate-500 dark:text-slate-400"><span>Accesos · últimos 14 días</span><span className="font-medium text-brand-700 dark:text-brand-300">en vivo</span></div>
            <AreaChart id="hero" className="h-20 w-full" data={[220, 260, 240, 310, 290, 330, 360, 340, 380, 350, 410, 390, 430, 460]} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="h-20 rounded-lg bg-white/70 p-2.5 dark:bg-white/5"><Bars data={[6, 9, 7, 11, 8, 12, 10]} /></div>
            <div className="space-y-1.5 rounded-lg bg-white/70 p-2.5 text-[10px] dark:bg-white/5">
              {[['Juan P.', 'Lote 214', 'bg-emerald-500'], ['Delivery', 'Lote 87', 'bg-sky-500'], ['Obrero', 'Lote 132', 'bg-amber-500']].map(([n, l, c]) => (
                <div key={n} className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                  <span className={`h-1.5 w-1.5 rounded-full ${c}`} />{n}</span><span className="text-slate-400">{l}</span></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** @param {{ icon: string, label: string, value: string, tone: string, className: string, delay?: string }} props */
function FloatingStat({ icon, label, value, tone, className, delay = '0s' }) {
  return (
    <div className={`absolute ${className}`}>
      <div className="glass flex animate-float items-center gap-3 rounded-2xl px-3.5 py-2.5" style={{ animationDelay: delay }}>
        <span className={`grid h-9 w-9 place-items-center rounded-xl ${tone}`}><Icon name={icon} className="h-[18px] w-[18px]" /></span>
        <span className="text-left">
          <span className="block text-[11px] text-slate-500 dark:text-slate-400">{label}</span>
          <span className="block font-display text-base font-bold leading-tight text-slate-900 dark:text-white">{value}</span>
        </span>
      </div>
    </div>
  );
}

/** Desplazamiento x/y de una capa según el mouse (depth en px; negativo = se mueve en sentido opuesto). */
function useParallaxLayer(sx, sy, depth) {
  return {
    x: useTransform(sx, [-0.5, 0.5], [-depth, depth]),
    y: useTransform(sy, [-0.5, 0.5], [-depth, depth]),
  };
}

/** @param {{ onDemo: () => void }} props */
export function Hero({ onDemo }) {
  const ref = useRef(null);
  const fine = useFinePointer();
  const reduce = useReducedMotion();
  const interactive = fine && !reduce;

  // Posición del mouse normalizada (-0.5…0.5) suavizada con resorte
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 90, damping: 18, mass: 0.6 });
  const sy = useSpring(my, { stiffness: 90, damping: 18, mass: 0.6 });
  const rotY = useTransform(sx, [-0.5, 0.5], [-9, 9]);
  const rotX = useTransform(sy, [-0.5, 0.5], [7, -7]);
  const near = useParallaxLayer(sx, sy, 26);
  const far = useParallaxLayer(sx, sy, -14);

  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  };
  const onLeave = () => { mx.set(0); my.set(0); };

  return (
    <section id="inicio" ref={ref} onPointerMove={interactive ? onMove : undefined} onPointerLeave={interactive ? onLeave : undefined}
      className="relative isolate overflow-hidden px-4 pb-20 pt-32 sm:px-6 sm:pb-28 sm:pt-40" aria-labelledby="hero-title">
      <Scene id="hero" priority intensity="strong" />

      <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
        <div className="text-center lg:text-left">
          <p style={{ '--d': 0 }} className="hero-enter mb-5 inline-flex items-center gap-2 rounded-full border border-brand-600/20 bg-white/70 px-3 py-1 text-xs font-semibold text-brand-800 dark:border-brand-400/20 dark:bg-white/5 dark:text-brand-300">
            <span className="relative flex h-2 w-2"><span className="absolute inset-0 animate-pulse-ring rounded-full bg-brand-500" /><span className="relative h-2 w-2 rounded-full bg-brand-500" /></span>
            {HERO.eyebrow}
          </p>
          <h1 id="hero-title" style={{ '--d': 1 }} className="hero-enter-text text-balance font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-950 sm:text-5xl lg:text-6xl dark:text-white">
            {HERO.title}
          </h1>
          <p style={{ '--d': 2 }} className="hero-enter-text text-pretty mx-auto mt-6 max-w-xl text-lg leading-relaxed text-slate-700 lg:mx-0 dark:text-slate-300">
            {HERO.subtitle}
          </p>
          <div style={{ '--d': 3 }} className="hero-enter mt-9 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
            <button type="button" onClick={onDemo} className="btn-primary h-12 rounded-full px-7 text-base shadow-lg shadow-brand-700/25">
              Solicitar Demo <Icon name="arrowRight" className="h-4 w-4" />
            </button>
            <a href="#funcionalidades" className="btn-secondary h-12 rounded-full px-7 text-base">Ver Funcionalidades</a>
          </div>
          <ul style={{ '--d': 4 }} className="hero-enter mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-slate-600 lg:justify-start dark:text-slate-400">
            {['Multi-complejo', 'App PWA para residentes', 'Datos aislados por complejo'].map((t) => (
              <li key={t} className="flex items-center gap-1.5"><Icon name="check" className="h-4 w-4 text-brand-600 dark:text-brand-400" strokeWidth={2.5} />{t}</li>
            ))}
          </ul>
        </div>

        <div className="hero-enter-mockup perspective relative mx-auto w-full max-w-xl">
          <div style={interactive ? { rotateX: rotX, rotateY: rotY } : undefined} className="preserve-3d relative">
            <div style={interactive ? far : undefined} aria-hidden="true"
              className="absolute -inset-10 -z-10 bg-[radial-gradient(closest-side,rgb(var(--brand-400)/0.35),rgb(125_211_252/0.15)_60%,transparent)] dark:bg-[radial-gradient(closest-side,rgb(var(--brand-500)/0.3),rgb(99_102_241/0.12)_60%,transparent)]" />
            <div role="img" aria-label="Vista previa del panel de administración con indicadores de accesos, expensas y reservas">
              <DashboardMockup />
            </div>
            <div style={interactive ? near : undefined} className="pointer-events-none absolute inset-0">
              <FloatingStat icon="users" label="Residentes activos" value="2.418" tone="bg-brand-600/15 text-brand-700 dark:text-brand-300"
                className="-left-3 -top-11 sm:-left-12 sm:-top-12" />
              <FloatingStat icon="gate" label="Accesos del día" value="386" tone="bg-sky-500/15 text-sky-700 dark:text-sky-300"
                className="-right-3 top-1/2 sm:-right-10" delay="-2s" />
              <FloatingStat icon="calendar" label="Reservas realizadas" value="57" tone="bg-amber-500/15 text-amber-700 dark:text-amber-300"
                className="-bottom-6 left-6 sm:left-12" delay="-4s" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
