// Parser del código PDF417 del DNI argentino (campos separados por "@").
//
// Formato nuevo (DNI tarjeta, 2012+):
//   TRAMITE@APELLIDO@NOMBRE@SEXO@DNI@EJEMPLAR@NACIMIENTO@EMISION@CUIL
//   00123456789@PEREZ@JUAN CARLOS@M@12345678@A@15/03/1985@20/06/2017@200
// Formato anterior (DNI libreta/tarjeta previa, empieza con "@"):
//   @DNI@EJEMPLAR@?@APELLIDO@NOMBRE@NACIONALIDAD@NACIMIENTO@SEXO@EMISION@TRAMITE@...@VENCIMIENTO@...
//   @12345678    @A@1@PEREZ@JUAN CARLOS@ARGENTINA@15/03/1985@M@20/06/2010@00123456789@7055 @20/06/2025@...

/**
 * @typedef {{ apellido: string, nombre: string, nombreCompleto: string, dni: string,
 *   sexo?: string, fechaNacimiento?: string, fechaEmision?: string, fechaVencimiento?: string,
 *   numeroTramite?: string, ejemplar?: string, formato: 'nuevo' | 'anterior' }} DniData
 */

const DATE = /^\d{2}\/\d{2}\/\d{4}$/;
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const digits = (s) => String(s ?? '').replace(/\D/g, '');
const isDni = (s) => /^\d{7,8}$/.test(digits(s)) && /^[\d\s.]+$/.test(String(s).trim());
const isSex = (s) => /^[MFX]$/i.test(String(s).trim());
const isName = (s) => /^[A-ZÁÉÍÓÚÜÑ' .-]{2,}$/i.test(clean(s)) && !DATE.test(clean(s));

const build = (o) => {
  const apellido = clean(o.apellido).toUpperCase();
  const nombre = clean(o.nombre).toUpperCase();
  const data = { ...o, apellido, nombre, nombreCompleto: clean(`${apellido} ${nombre}`), dni: digits(o.dni) };
  for (const k of Object.keys(data)) { if (data[k] === undefined || data[k] === '') { delete data[k]; } }
  return /** @type {DniData} */ (data);
};

/**
 * Convierte el texto del PDF417 en datos del DNI. Devuelve null si no tiene el formato esperado.
 * @param {string} raw
 * @returns {DniData | null}
 */
export function parseDniPdf417(raw) {
  if (typeof raw !== 'string') { return null; }
  const text = raw.replace(/[\r\n]+/g, '').trim();
  const f = text.split('@');
  if (f.length < 8) { return null; }

  // Formato anterior: empieza con "@" → f[0] vacío, DNI en f[1]
  if (f[0] === '' && isDni(f[1])) {
    const r = build({
      formato: 'anterior',
      dni: f[1], ejemplar: clean(f[2]), apellido: f[4], nombre: f[5],
      fechaNacimiento: DATE.test(clean(f[7])) ? clean(f[7]) : undefined,
      sexo: isSex(f[8]) ? clean(f[8]).toUpperCase() : undefined,
      fechaEmision: DATE.test(clean(f[9])) ? clean(f[9]) : undefined,
      numeroTramite: /^\d{6,}$/.test(clean(f[10])) ? clean(f[10]) : undefined,
      fechaVencimiento: f.slice(11).map(clean).find((x) => DATE.test(x)),
    });
    return r.dni && r.apellido && isName(f[4]) ? r : null;
  }

  // Formato nuevo: TRAMITE@APELLIDO@NOMBRE@SEXO@DNI@EJEMPLAR@NACIMIENTO@EMISION@...
  if (/^\d{6,}$/.test(clean(f[0])) && isSex(f[3]) && isDni(f[4])) {
    const r = build({
      formato: 'nuevo',
      numeroTramite: clean(f[0]), apellido: f[1], nombre: f[2], sexo: clean(f[3]).toUpperCase(), dni: f[4],
      ejemplar: clean(f[5]),
      fechaNacimiento: DATE.test(clean(f[6])) ? clean(f[6]) : undefined,
      fechaEmision: DATE.test(clean(f[7])) ? clean(f[7]) : undefined,
    });
    return isName(f[1]) && isName(f[2]) ? r : null;
  }
  return null;
}

/** Token de invitación QR de este sistema (32 caracteres hex). */
export const isInvitationToken = (text) => /^[a-f0-9]{32}$/i.test(String(text).trim());
