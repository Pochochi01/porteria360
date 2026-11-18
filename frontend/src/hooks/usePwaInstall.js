import { useEffect, useState } from 'react';
import { canPromptInstall, detectPlatform, isStandalone, promptInstall, subscribeInstall } from '../lib/pwa';

/**
 * Estado reactivo de instalación de la PWA.
 * @returns {{ platform: import('../lib/pwa').Platform, installed: boolean, canPrompt: boolean, install: () => Promise<string> }}
 */
export function usePwaInstall() {
  const [state, setState] = useState(() => ({ installed: isStandalone(), canPrompt: canPromptInstall() }));

  useEffect(() => {
    const update = () => setState({ installed: isStandalone(), canPrompt: canPromptInstall() });
    const mq = window.matchMedia('(display-mode: standalone)');
    mq.addEventListener('change', update);
    const off = subscribeInstall(update);
    update();
    return () => { mq.removeEventListener('change', update); off(); };
  }, []);

  return { platform: detectPlatform(), ...state, install: promptInstall };
}
