// Estado de instalación de la PWA, compartido por toda la app.
// `beforeinstallprompt` se dispara muy temprano (a veces antes de que React monte):
// por eso se captura acá, al importar el módulo desde main.jsx, y se guarda para usarlo después.

/** @typedef {'android' | 'ios' | 'desktop'} Platform */

let deferred = null; // evento BeforeInstallPromptEvent (Chrome/Edge/Samsung Internet)
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // sin mini-barra del navegador: usamos nuestra propia invitación
    deferred = e;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    emit();
  });
}

/** @returns {Platform} */
export function detectPlatform() {
  if (typeof navigator === 'undefined') { return 'desktop'; }
  const ua = navigator.userAgent;
  // iPadOS 13+ se presenta como Mac: se reconoce por la pantalla táctil
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS) { return 'ios'; }
  if (/Android/i.test(ua)) { return 'android'; }
  return 'desktop';
}

/** true si la app corre instalada (ventana propia), en cualquier plataforma. */
export function isStandalone() {
  if (typeof window === 'undefined') { return false; }
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: window-controls-overlay)').matches
    || navigator.standalone === true; // Safari iOS
}

/** En iOS solo Safari puede instalar ("Agregar a inicio"); Chrome/Firefox iOS también desde iOS 16.4. */
export const isIosSafari = () => detectPlatform() === 'ios' && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);

export const canPromptInstall = () => !!deferred;

/** Abre el diálogo nativo de instalación. @returns {Promise<'accepted'|'dismissed'|'unavailable'>} */
export async function promptInstall() {
  if (!deferred) { return 'unavailable'; }
  const e = deferred;
  deferred = null; // el evento se puede usar una sola vez
  emit();
  await e.prompt();
  const { outcome } = await e.userChoice;
  return outcome;
}

/** @param {() => void} fn */
export function subscribeInstall(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
