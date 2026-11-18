import { Fragment, useEffect, useId, useState } from 'react';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { enablePush, pushPermission } from '../lib/push';
import { isIosSafari } from '../lib/pwa';
import { Icon } from './icons';

// Preferencias del usuario en este dispositivo (si el almacenamiento falla, el aviso simplemente vuelve a mostrarse)
const KEY_INSTALL = 'pwa:install-dismissed';
const KEY_PUSH = 'pwa:push-dismissed';
const read = (k) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
const save = (k) => { try { localStorage.setItem(k, '1'); } catch { /* modo privado */ } };

const STEPS = {
  ios: [
    <Fragment key="s0">Tocá <b>Compartir</b> <ShareGlyph /> en la barra de Safari.</Fragment>,
    <Fragment key="s1">Elegí <b>Agregar a inicio</b>.</Fragment>,
    <Fragment key="s2">Confirmá con <b>Agregar</b>. La app aparece en tu pantalla de inicio.</Fragment>,
  ],
  android: [
    <Fragment key="s3">Abrí el menú <b>⋮</b> del navegador.</Fragment>,
    <Fragment key="s4">Elegí <b>Instalar aplicación</b> o <b>Agregar a pantalla principal</b>.</Fragment>,
    <Fragment key="s5">Confirmá con <b>Instalar</b>.</Fragment>,
  ],
  desktop: [
    <Fragment key="s6">Hacé clic en el ícono de instalar <b>⊕</b> a la derecha de la barra de direcciones.</Fragment>,
    <Fragment key="s7">O abrí el menú del navegador y elegí <b>Instalar AdminCountrys</b>.</Fragment>,
  ],
};

function ShareGlyph() {
  return <Icon name="upload" className="inline h-4 w-4 align-[-2px]" title="Compartir" />;
}

/** Panel inferior (móvil) o tarjeta flotante (escritorio), sin bloquear la pantalla. */
function Sheet({ labelId, onClose, children }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(true));
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(t); window.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return (
    <section role="dialog" aria-modal="false" aria-labelledby={labelId}
      className={`fixed inset-x-0 bottom-0 z-40 max-h-[85dvh] overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 pb-safe shadow-2xl
        transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] dark:border-slate-800 dark:bg-slate-900
        sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[24rem] sm:rounded-2xl ${shown ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}`}>
      <button type="button" onClick={onClose} aria-label="Cerrar"
        className="absolute right-2 top-2 grid h-11 w-11 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
        <Icon name="x" />
      </button>
      {children}
    </section>
  );
}

function InstallPrompt({ platform, canPrompt, install, onDone }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [showSteps, setShowSteps] = useState(!canPrompt);
  const iosOther = platform === 'ios' && !isIosSafari();

  const onInstall = async () => {
    setBusy(true);
    const r = await install().catch(() => 'unavailable');
    setBusy(false);
    if (r === 'accepted') { onDone(); } else if (r === 'unavailable') { setShowSteps(true); }
  };

  return (
    <Sheet labelId={id} onClose={onDone}>
      <div className="flex items-start gap-3 pr-10">
        <img src="/icon-192.png" alt="" width="48" height="48" className="h-12 w-12 shrink-0 rounded-xl shadow-sm" />
        <div>
          <h2 id={id} className="font-display text-lg font-bold leading-tight">Instalá AdminCountrys</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Instalar la aplicación permite acceder más rápido, recibir notificaciones en tiempo real, utilizar funciones
            optimizadas para dispositivos móviles y mejorar la experiencia de uso.
          </p>
        </div>
      </div>

      <div className="mt-4 flex gap-3 rounded-xl bg-brand-50 p-3 text-sm text-brand-900 dark:bg-brand-500/10 dark:text-brand-100">
        <Icon name="bell" className="mt-0.5 h-5 w-5 shrink-0" />
        <p>Instalando la aplicación podrás recibir avisos de visitas, accesos, expensas, reservas y novedades importantes.</p>
      </div>

      <details className="group mt-3 text-sm text-slate-600 dark:text-slate-300">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 font-medium text-slate-800 dark:text-slate-100">
          ¿Qué es una PWA?
          <Icon name="down" className="h-4 w-4 transition-transform duration-200 group-open:rotate-180" />
        </summary>
        <p>
          Una PWA (Progressive Web App) funciona como una aplicación instalada en tu dispositivo, pero sin necesidad de
          descargarla desde una tienda. Además consume menos recursos y espacio que una aplicación nativa tradicional.
        </p>
      </details>

      {showSteps && (
        <div className="mt-3">
          {iosOther && <p className="mb-2 text-sm text-amber-700 dark:text-amber-300">Si no ves la opción, abrí esta página en <b>Safari</b>.</p>}
          <ol className="space-y-2 text-sm">
            {STEPS[platform].map((s, i) => (
              <li key={s.key} className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-bold dark:bg-slate-800">{i + 1}</span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondary min-h-11" onClick={onDone}>Ahora no</button>
        {canPrompt
          ? <button type="button" className="btn-primary min-h-11" onClick={onInstall} disabled={busy}>{busy ? 'Instalando…' : 'Instalar'}</button>
          : !showSteps && <button type="button" className="btn-primary min-h-11" onClick={() => setShowSteps(true)}>Cómo instalar</button>}
      </div>
    </Sheet>
  );
}

function PushPrompt({ onDone }) {
  const id = useId();
  const [state, setState] = useState('idle'); // idle | busy | denied | error
  const onEnable = async () => {
    setState('busy');
    try {
      const r = await enablePush();
      if (r === 'granted') { onDone(); } else { setState(r === 'denied' ? 'denied' : 'idle'); }
    } catch { setState('error'); }
  };
  return (
    <Sheet labelId={id} onClose={onDone}>
      <div className="flex items-start gap-3 pr-10">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-800 dark:bg-brand-500/15 dark:text-brand-200">
          <Icon name="bell" className="h-6 w-6" />
        </span>
        <div>
          <h2 id={id} className="font-display text-lg font-bold leading-tight">Activá las notificaciones</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Recibí avisos de visitas, accesos, expensas, reservas y novedades importantes, aunque la app esté cerrada.
          </p>
        </div>
      </div>
      {state === 'denied' && <p role="alert" className="mt-3 text-sm text-amber-700 dark:text-amber-300">Las notificaciones están bloqueadas. Podés habilitarlas desde los ajustes del dispositivo.</p>}
      {state === 'error' && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">No se pudieron activar. Probá de nuevo en unos minutos.</p>}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondary min-h-11" onClick={onDone}>Ahora no</button>
        {state !== 'denied' && <button type="button" className="btn-primary min-h-11" onClick={onEnable} disabled={state === 'busy'}>{state === 'busy' ? 'Activando…' : 'Activar'}</button>}
      </div>
    </Sheet>
  );
}

/**
 * Invitaciones del panel, una a la vez y con demora para no interrumpir el primer uso:
 *  1. Sin instalar → invitar a instalar (con pasos según Android, iOS o escritorio).
 *  2. Instalada y permiso sin decidir → ofrecer notificaciones. El permiso se pide solo al tocar "Activar".
 * Cada aviso descartado no vuelve a mostrarse en este dispositivo.
 */
export function AppPrompts() {
  const pwa = usePwaInstall();
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(() => ({ install: read(KEY_INSTALL), push: read(KEY_PUSH) }));

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 2500);
    return () => clearTimeout(t);
  }, []);

  if (!ready) { return null; }
  const close = (k, key) => () => { save(key); setDismissed((d) => ({ ...d, [k]: true })); };

  if (!pwa.installed && !dismissed.install) {
    return <InstallPrompt {...pwa} onDone={close('install', KEY_INSTALL)} />;
  }
  if (pwa.installed && !dismissed.push && pushPermission() === 'default') {
    return <PushPrompt onDone={close('push', KEY_PUSH)} />;
  }
  return null;
}
