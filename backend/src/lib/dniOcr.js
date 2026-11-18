// OCR del DNI argentino: preprocesamiento con sharp + Tesseract + parser del texto.
// Todo en memoria: la imagen nunca se escribe en disco.
import sharp from 'sharp';
import { TESSERACT_CACHE } from './paths.js';
import { createWorker } from 'tesseract.js';

// ---------- Parser del texto OCR ----------

/** @typedef {{ apellido: string, nombre: string, nombreCompleto: string, dni: string }} DniOcr */

const LABEL = /(APELLIDO|SURNAME|NOMBRE|\bNAME\b|SEXO|\bSEX\b|NACIONALIDAD|NATIONALITY|FECHA|DATE|DOCUMENTO|DOCUMENT|EJEMPLAR|TRAMITE|FIRMA|SIGNATURE|REPUBLICA|ARGENTINA|REGISTRO|NACIONAL|PERSONAS|MERCOSUR)/;
const cleanLine = (l) => l.toUpperCase()
  .replace(/[|_~^`"“”'’«»]/g, ' ')
  .replace(/[^A-ZÁÉÍÓÚÜÑ0-9.</ -]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const onlyName = (l) => l.replace(/[^A-ZÁÉÍÓÚÜÑ ]/g, ' ').replace(/\s+/g, ' ').trim();
const looksLikeName = (l) => {
  const n = onlyName(l);
  return n.length >= 2 && n.replace(/ /g, '').length >= 2 && !LABEL.test(n) && n.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, '').length / Math.max(l.replace(/\s/g, '').length, 1) > 0.8;
};

/** Número de DNI: 12.345.678 / 12345678 (7 u 8 dígitos). Corrige confusiones típicas del OCR (O→0, I/l→1). */
function findDni(lines) {
  const fix = (s) => s.replace(/[OQD]/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
  const text = lines.join('\n');
  // 1) Con puntos: 12.345.678
  const dotted = text.match(/\b\d{1,2}\s?\.\s?\d{3}\s?\.\s?\d{3}\b/);
  if (dotted) { return dotted[0].replace(/\D/g, ''); }
  // 2) Después del rótulo DOCUMENTO / DNI (misma línea o la siguiente)
  for (let i = 0; i < lines.length; i++) {
    if (!/DOCUMENTO|DOCUMENT|\bDNI\b/.test(lines[i])) { continue; }
    for (const l of [lines[i], lines[i + 1] || '']) {
      const m = fix(l.replace(/DOCUMENTO|DOCUMENT|DNI/g, ' ')).match(/\b\d{7,8}\b/);
      if (m) { return m[0]; }
    }
  }
  // 3) Cualquier número suelto de 7-8 dígitos que no sea parte de una fecha ni del trámite (11 dígitos)
  const loose = text.replace(/\d{2}\s?[/.-]\s?\d{2}\s?[/.-]\s?\d{2,4}/g, ' ').match(/(?<!\d)\d{7,8}(?!\d)/);
  return loose ? loose[0] : '';
}

/** Zona MRZ del dorso: IDARG12345678<… y APELLIDO<<NOMBRE<NOMBRE2<<<< */
function parseMrz(lines) {
  const mrz = lines.map((l) => l.replace(/\s/g, '').replace(/[«]/g, '<')).filter((l) => (l.match(/</g) || []).length >= 3);
  if (!mrz.length) { return null; }
  const docLine = mrz.find((l) => /IDARG/.test(l));
  const dni = docLine?.match(/IDARG\D?(\d{7,8})/)?.[1] || '';
  const nameLine = mrz.find((l) => /^[A-ZÑ]+(<[A-ZÑ]+)*<<[A-ZÑ]/.test(l));
  if (!nameLine) { return dni ? { apellido: '', nombre: '', dni } : null; }
  const [ape, nom = ''] = nameLine.split('<<');
  return { apellido: ape.replace(/</g, ' ').trim(), nombre: nom.replace(/<+$/, '').replace(/</g, ' ').trim(), dni };
}

/** Rótulos del frente: "Apellido / Surname" y "Nombre / Name" con el valor en la línea siguiente. */
function parseFront(lines) {
  const valueAfter = (re) => {
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) { continue; }
      // El valor puede estar en la misma línea, después del rótulo
      const same = lines[i].replace(/APELLIDO|SURNAME|NOMBRE|\bNAME\b|\//g, ' ');
      if (looksLikeName(same) && onlyName(same).length >= 3) { return onlyName(same); }
      for (let j = i + 1; j <= i + 2 && j < lines.length; j++) { if (looksLikeName(lines[j])) { return onlyName(lines[j]); } }
    }
    return '';
  };
  return {
    apellido: valueAfter(/APELLIDO|SURNAME/),
    nombre: valueAfter(/NOMBRE|(?<!SUR)\bNAME\b/),
  };
}

/**
 * Extrae apellido, nombre y DNI del texto OCR.
 * @param {string} text
 * @returns {DniOcr & { found: boolean, fuente: 'frente' | 'mrz' | 'parcial' | 'ninguna' }}
 */
export function parseDniOcrText(text) {
  const lines = String(text || '').split(/\r?\n/).map(cleanLine).filter(Boolean);
  const front = parseFront(lines);
  const mrz = parseMrz(lines);
  let apellido = front.apellido;
  let nombre = front.nombre;
  let fuente = apellido && nombre ? 'frente' : 'parcial';
  if ((!apellido || !nombre) && mrz?.apellido) { apellido = mrz.apellido; nombre = mrz.nombre; fuente = 'mrz'; }
  const dni = findDni(lines) || mrz?.dni || '';
  const nombreCompleto = `${apellido} ${nombre}`.replace(/\s+/g, ' ').trim();
  const found = Boolean(dni && apellido);
  return { apellido, nombre, nombreCompleto, dni, found, fuente: found ? fuente : dni || apellido ? 'parcial' : 'ninguna' };
}

// ---------- Preprocesamiento ----------

/** Escala de grises, normalización, contraste y nitidez; rota según EXIF y escala para el OCR. */
async function preprocess(buffer, extraRotation = 0) {
  let img = sharp(buffer, { failOn: 'error' }).rotate(); // rotación automática por EXIF
  if (extraRotation) { img = sharp(await img.toBuffer()).rotate(extraRotation); }
  const { width = 0 } = await img.clone().metadata();
  return img
    .resize({ width: Math.min(Math.max(width, 1600), 2400) }) // el OCR rinde mejor con ~2000px de ancho
    .grayscale()
    .normalize()
    .linear(1.25, -18) // más contraste
    .sharpen({ sigma: 1.1 })
    .png()
    .toBuffer();
}

// ---------- Tesseract (un solo worker reutilizado, trabajos en serie) ----------

let workerPromise;
let queue = Promise.resolve();
const getWorker = () => {
  workerPromise ??= createWorker('spa', 1, {
    cachePath: TESSERACT_CACHE, // el modelo de idioma se descarga una vez
    logger: () => {},
    errorHandler: () => {},
  }).catch((e) => { workerPromise = undefined; throw e; });
  return workerPromise;
};
const recognize = (png) => {
  const job = queue.then(async () => (await (await getWorker()).recognize(png)).data);
  queue = job.catch(() => {});
  return job;
};

/**
 * OCR completo de una foto de DNI. Si no encuentra datos y la foto parece girada, prueba a 90°/270°.
 * @param {Buffer} buffer imagen validada (jpg/png/webp)
 */
export async function ocrDni(buffer) {
  const meta = await sharp(buffer).rotate().metadata();
  const rotations = [0, ...(meta.height > meta.width * 1.15 ? [90, 270] : [180])];
  let best = null;
  for (const rot of rotations) {
    const data = await recognize(await preprocess(buffer, rot));
    const parsed = parseDniOcrText(data.text);
    const score = (parsed.dni ? 2 : 0) + (parsed.apellido ? 1 : 0) + (parsed.nombre ? 1 : 0);
    if (!best || score > best.score) { best = { ...parsed, score, confidence: Math.round(data.confidence), rotation: rot }; }
    if (parsed.found && parsed.nombre) { break; }
  }
  const { score, ...result } = best;
  return result;
}

export async function shutdownOcr() {
  if (workerPromise) { await (await workerPromise).terminate().catch(() => {}); }
  workerPromise = undefined;
}
