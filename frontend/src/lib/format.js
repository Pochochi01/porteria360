// Formato y helpers de presentación compartidos.

export const fmtDate = (s) => (s ? new Date(s.replace(' ', 'T')).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const money = (n) => Number(n).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });

/** { clave: etiqueta } → [{ value, label }] para <select>. */
export const opts = (obj) => Object.entries(obj).map(([value, label]) => ({ value, label }));

/** Fecha sin hora: "2027-03-12" → "12/03/2027". */
export const fmtDay = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');

/** Período actual "AAAA-MM". */
export const currentPeriod = () => new Date().toISOString().slice(0, 7);

/** Porcentaje con formato argentino: 60.9 → "60,9%". */
export const fmtPct = (n) => `${Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`;
