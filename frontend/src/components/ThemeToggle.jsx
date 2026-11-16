import { useTheme } from '../theme/theme';
import { Icon } from './icons';

/** Botón sol/luna con crossfade + rotación (200ms ease-out). */
export function ThemeToggle({ className = '' }) {
  const { toggle } = useTheme();
  return (
    <button type="button" onClick={toggle} aria-label="Cambiar entre modo claro y oscuro" title="Modo claro / oscuro"
      className={`relative grid h-9 w-9 place-items-center rounded-full border border-slate-300/70 bg-white/70 text-slate-700 transition-[transform,background-color] duration-150 ease-out hover:bg-white active:scale-95 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10 ${className}`}>
      <span className="absolute transition-[opacity,transform] duration-200 ease-out rotate-0 scale-100 opacity-100 dark:rotate-90 dark:scale-75 dark:opacity-0">
        <Icon name="sun" className="h-[18px] w-[18px]" />
      </span>
      <span className="absolute transition-[opacity,transform] duration-200 ease-out -rotate-90 scale-75 opacity-0 dark:rotate-0 dark:scale-100 dark:opacity-100">
        <Icon name="moon" className="h-[18px] w-[18px]" />
      </span>
    </button>
  );
}
