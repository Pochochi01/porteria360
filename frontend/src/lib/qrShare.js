// Imagen del QR de acceso (PNG) para compartir por WhatsApp u otra app.
// Se comparte el ARCHIVO, no un link: el visitante lo muestra en la guardia desde su galería.
import { saveBlob } from './download';

const W = 720;
const PAD = 56;

/** Corta un texto en líneas que entran en `max` px. */
function wrap(ctx, text, max) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > max && line) { lines.push(line); line = w; } else { line = t; }
  }
  if (line) { lines.push(line); }
  return lines.slice(0, 2);
}

/**
 * Compone una tarjeta con el QR, el nombre del visitante y la validez.
 * @param {HTMLCanvasElement} qrCanvas canvas del QR ya dibujado (QRCodeCanvas)
 * @param {{ title: string, name: string, validity: string, footer?: string }} info
 * @returns {Promise<Blob>}
 */
export async function composeQrImage(qrCanvas, { title, name, validity, footer }) {
  const qr = W - PAD * 2;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = (w, s) => `${w} ${s}px Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;

  ctx.font = font(700, 40);
  const nameLines = wrap(ctx, name, W - PAD * 2);
  const H = PAD + 40 + 24 + qr + 40 + nameLines.length * 48 + 40 + (footer ? 44 : 0) + PAD;
  c.width = W;
  c.height = H;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  let y = PAD;
  ctx.fillStyle = '#475569';
  ctx.font = font(600, 28);
  ctx.fillText(title, W / 2, y);
  y += 40 + 24;

  ctx.imageSmoothingEnabled = false; // módulos del QR nítidos al escalar
  ctx.drawImage(qrCanvas, PAD, y, qr, qr);
  y += qr + 40;

  ctx.fillStyle = '#0f172a';
  ctx.font = font(700, 40);
  for (const l of nameLines) { ctx.fillText(l, W / 2, y); y += 48; }

  ctx.fillStyle = '#334155';
  ctx.font = font(500, 26);
  ctx.fillText(validity, W / 2, y + 4);
  y += 40;

  if (footer) {
    ctx.fillStyle = '#64748b';
    ctx.font = font(400, 22);
    ctx.fillText(footer, W / 2, y + 12);
  }

  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), 'image/png');
  });
}

/** true si el dispositivo puede compartir archivos de imagen (Android, iOS 15+, Edge/Chrome en Windows y macOS). */
export function canShareImage() {
  if (typeof navigator === 'undefined' || !navigator.canShare || typeof File === 'undefined') { return false; }
  try {
    return navigator.canShare({ files: [new File([''], 'qr.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

/**
 * Abre el selector nativo de compartir (WhatsApp, Telegram, Mail…) con la imagen.
 * Sin soporte, descarga el PNG para enviarlo desde cualquier app.
 * Llamar sincrónicamente desde el click (Safari exige el gesto del usuario): por eso el blob se genera antes.
 * @param {Blob} blob
 * @param {string} filename
 * @param {string} text mensaje sin enlaces
 * @returns {Promise<'shared'|'downloaded'|'cancelled'>}
 */
export async function shareImage(blob, filename, text) {
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      // iOS descarta el texto en algunas apps; la imagen lleva el nombre y la validez impresos
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') { return 'cancelled'; }
      // NotAllowedError u otro: se ofrece la descarga como alternativa
    }
  }
  saveBlob(blob, filename);
  return 'downloaded';
}
