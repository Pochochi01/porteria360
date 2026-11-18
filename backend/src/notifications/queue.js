// NotificationQueue: procesa la tabla notifications en segundo plano.
//  - Persistente: lo encolado sobrevive a reinicios (la cola es MySQL, no memoria).
//  - Sin bloqueos: los controladores encolan y responden; el envío ocurre acá.
//  - Reintentos con espera creciente ante caídas temporales del proveedor (repository.complete).
import { claim, complete } from './repository.js';
import { dispatch } from './dispatcher.js';

const POLL_MS = 5000;
let timer = null;
let current = null; // ciclo en curso (promesa)
let again = false;

function drain() {
  if (current) { again = true; return current; } // nunca dos ciclos a la vez
  current = cycle().finally(() => { current = null; });
  return current;
}

async function cycle() {
  try {
    do {
      again = false;
      for (let batch = await claim(); batch.length; batch = await claim()) {
        for (const n of batch) {
          try {
            const status = await complete(n, await dispatch(n));
            if (status === 'failed') { console.warn(`[notifications] #${n.id} ${n.type} falló`); }
          } catch (e) {
            // Error inesperado (base caída, bug): vuelve a la cola con reintento
            console.error(`[notifications] #${n.id}`, e.message);
            await complete(n, { devices: 1, delivered: [], transientError: e.message }).catch(() => {});
          }
        }
      }
    } while (again);
  } catch (e) {
    console.error('[notifications] cola:', e.message);
  }
}

/** Procesa ya (después de encolar), sin esperar al próximo ciclo. */
export const kick = () => { if (timer) { setImmediate(drain); } };

export function start() {
  if (timer) { return; }
  timer = setInterval(drain, POLL_MS);
  timer.unref?.();
  setImmediate(drain);
}

/** Espera a que termine el lote en curso (apagado ordenado). */
export async function stop() {
  clearInterval(timer);
  timer = null;
  await current;
}

/** Solo para pruebas: procesa la cola de forma sincrónica. */
export const drainNow = drain;
