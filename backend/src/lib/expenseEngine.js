// Motor de prorrateo de expensas. Funciones puras (sin base de datos) para poder probarlas aisladas.
//
// Cada método recibe los lotes y los parámetros y devuelve un PESO por lote; el reparto en centavos
// es común a todos (redondeo por mayor resto: la suma da exactamente el total).
// Para agregar un método nuevo: sumar una entrada a METHODS. Nada más cambia.

/** @typedef {{ id: number, code: string, share_pct?: number|null, coefficient?: number|null, surface_m2?: number|null }} Lot */
/** @typedef {{ lot_id: number, lot_code: string, amount: number, detail: Record<string, unknown> }} Row */

export class EngineError extends Error {}

const num = (v) => (v == null || v === '' ? NaN : Number(v));
const requireField = (lots, field, label) => {
  const missing = lots.filter((l) => !(num(l[field]) > 0)).map((l) => l.code);
  if (missing.length) { throw new EngineError(`Falta ${label} en ${missing.length} lote(s): ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}`); }
};

/** Pesos por método. `fixed` no reparte un total: asigna el mismo importe a cada lote. */
export const METHODS = {
  percentage: {
    label: 'Porcentaje por lote',
    weights(lots) {
      requireField(lots, 'share_pct', 'el porcentaje');
      const sum = lots.reduce((a, l) => a + num(l.share_pct), 0);
      if (Math.abs(sum - 100) > 0.01) { throw new EngineError(`Los porcentajes suman ${sum.toFixed(4)}%; deben sumar 100%`); }
      return lots.map((l) => num(l.share_pct));
    },
  },
  coefficient: {
    label: 'Coeficiente',
    weights(lots) {
      requireField(lots, 'coefficient', 'el coeficiente');
      return lots.map((l) => num(l.coefficient));
    },
  },
  surface: {
    label: 'Metros cuadrados',
    weights(lots) {
      requireField(lots, 'surface_m2', 'la superficie (m²)');
      return lots.map((l) => num(l.surface_m2));
    },
  },
  fixed: {
    label: 'Valor fijo',
    fixed: true,
  },
  mixed: {
    label: 'Mixto',
    /** params.parts: [{ method, weight }] — p. ej. 70% por m² + 30% en partes iguales */
    weights(lots, params) {
      const parts = params?.parts;
      if (!Array.isArray(parts) || !parts.length) { throw new EngineError('El método mixto requiere al menos una parte'); }
      const totalWeight = parts.reduce((a, p) => a + num(p.weight), 0);
      if (Math.abs(totalWeight - 100) > 0.01) { throw new EngineError('Las partes del método mixto deben sumar 100%'); }
      const acc = lots.map(() => 0);
      for (const p of parts) {
        // Validar antes de calcular: un "mixed" dentro del mixto sería recursión infinita
        if (p.method !== 'equal' && (p.method === 'mixed' || !METHODS[p.method]?.weights)) {
          throw new EngineError(`Método inválido en el mixto: ${p.method}`);
        }
        const sub = p.method === 'equal' ? lots.map(() => 1) : METHODS[p.method].weights(lots, params);
        const s = sub.reduce((a, b) => a + b, 0);
        sub.forEach((w, i) => { acc[i] += (w / s) * num(p.weight); });
      }
      return acc;
    },
  },
};

/** Reparte `totalCents` según los pesos, sin perder ni sobrar centavos (método del mayor resto). */
export function allocate(totalCents, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) { throw new EngineError('No hay base de prorrateo (pesos en cero)'); }
  const exact = weights.map((w) => (totalCents * w) / sum);
  const cents = exact.map(Math.floor);
  let rest = totalCents - cents.reduce((a, b) => a + b, 0);
  // Los centavos que sobran van a los lotes con mayor parte decimal (desempate estable por orden)
  const order = exact.map((e, i) => [e - Math.floor(e), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0; k++, rest--) { cents[order[k % order.length][1]] += 1; }
  return cents;
}

/**
 * Calcula la expensa de cada lote.
 * @param {{ lots: Lot[], method: keyof METHODS, total?: number, params?: Record<string, any> }} input
 * @returns {{ rows: Row[], total: number }}
 */
export function computeSettlements({ lots, method, total, params = {} }) {
  const m = METHODS[method];
  if (!m) { throw new EngineError(`Método desconocido: ${method}`); }
  if (!lots.length) { throw new EngineError('El complejo no tiene lotes'); }
  const sorted = [...lots].sort((a, b) => String(a.code).localeCompare(String(b.code), 'es', { numeric: true }));

  if (m.fixed) {
    const amount = num(params.amount);
    if (!(amount > 0)) { throw new EngineError('Indicá el valor fijo por lote'); }
    const cents = Math.round(amount * 100);
    const rows = sorted.map((l) => ({ lot_id: l.id, lot_code: l.code, amount: cents / 100, detail: { metodo: method, valor_fijo: cents / 100 } }));
    return { rows, total: (cents * rows.length) / 100 };
  }

  const totalCents = Math.round(num(total) * 100);
  if (!(totalCents > 0)) { throw new EngineError('El total a prorratear debe ser mayor a 0'); }
  const weights = m.weights(sorted, params);
  const cents = allocate(totalCents, weights);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const rows = sorted.map((l, i) => ({
    lot_id: l.id,
    lot_code: l.code,
    amount: cents[i] / 100,
    detail: { metodo: method, participacion_pct: Number(((weights[i] / weightSum) * 100).toFixed(6)) },
  }));
  return { rows, total: totalCents / 100 };
}
