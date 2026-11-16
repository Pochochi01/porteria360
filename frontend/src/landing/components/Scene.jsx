import { ResponsiveImage } from '../../components/ResponsiveImage';

// Ventanas iluminadas (modo oscuro): posiciones en % sobre la foto
const LIGHTS = [
  [18, 62, 90], [31, 48, 60], [44, 70, 120], [57, 55, 70], [66, 38, 80], [78, 64, 110], [86, 46, 60], [9, 40, 70],
];
// Un solo background con varios gradientes radiales: mismo efecto que spans con blur, sin costo de filtros
const WINDOW_LIGHTS = LIGHTS.map(([x, y, s]) => `radial-gradient(${s}px circle at ${x}% ${y}%, rgb(252 211 77 / 0.22), transparent 70%)`).join(', ');

/**
 * Fondo inmersivo: la foto nunca se oculta; encima cambian las capas según el tema (crossfade de 900ms).
 * Claro: celeste/blanco translúcido + luz solar. Oscuro: azul noche + luces cálidas de ventanas + glow urbano.
 * @param {{ id: string, variant?: import('../../components/ResponsiveImage').Variant, priority?: boolean, sizes?: string, className?: string,
 *           fade?: boolean, intensity?: 'soft' | 'strong' }} props
 */
export function Scene({ id, variant = 'day', priority = false, sizes = '100vw', className = '', fade = true, intensity = 'soft' }) {
  const strong = intensity === 'strong';
  return (
    <div className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden ${className}`} aria-hidden="true">
      <ResponsiveImage id={id} variant={variant} priority={priority} sizes={sizes} fill className="absolute inset-0 h-full w-full" alt="" />

      {/* Capa clara */}
      <div className="visible absolute inset-0 opacity-100 transition-[opacity,visibility] duration-[900ms] ease-in-out dark:invisible dark:opacity-0">
        <div className={`absolute inset-0 bg-gradient-to-b ${strong ? 'from-sky-100/85 via-white/70 to-white/90' : 'from-sky-100/70 via-white/45 to-white/80'}`} />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_45%_50%_at_80%_5%,rgb(254_243_199/0.75),transparent_70%),radial-gradient(ellipse_35%_40%_at_5%_55%,rgb(186_230_253/0.6),transparent_70%)]" />
      </div>

      {/* Capa oscura */}
      <div className="invisible absolute inset-0 opacity-0 transition-[opacity,visibility] duration-[900ms] ease-in-out dark:visible dark:opacity-100">
        <div className={`absolute inset-0 bg-gradient-to-b ${strong ? 'from-slate-950/90 via-blue-950/75 to-slate-950/95' : 'from-slate-950/80 via-blue-950/60 to-slate-950/90'}`} />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_15%,rgb(251_191_36/0.18),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_90%,rgb(56_189_248/0.15),transparent_60%)]" />
        <div className="absolute inset-0" style={{ backgroundImage: WINDOW_LIGHTS }} />
      </div>

      {fade && <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-slate-50 dark:to-slate-950" />}
    </div>
  );
}
