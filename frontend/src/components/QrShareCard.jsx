import { useEffect, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { canShareImage, composeQrImage, shareImage } from '../lib/qrShare';
import { saveBlob } from '../lib/download';
import { fmtDate } from '../lib/format';
import { Icon } from './icons';

const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'visita';

/**
 * QR de acceso recién generado, con "Enviar por WhatsApp": comparte la IMAGEN (PNG) con el
 * selector nativo del dispositivo. Sin Web Share de archivos (algunos navegadores de escritorio), descarga el PNG.
 * @param {{ qr: { token: string, visitor_name: string, valid_from: string, valid_until: string } }} props
 */
export function QrShareCard({ qr }) {
  const canvasRef = useRef(null);
  const [blob, setBlob] = useState(null);
  const [msg, setMsg] = useState('');
  const shareable = canShareImage();
  const validity = `Válido ${fmtDate(qr.valid_from)} — ${fmtDate(qr.valid_until)}`;
  const filename = `acceso-${slug(qr.visitor_name)}.png`;

  // La imagen se arma apenas aparece el QR: al tocar el botón se comparte en el mismo gesto (requisito de iOS)
  useEffect(() => {
    let alive = true;
    setBlob(null);
    setMsg('');
    const c = canvasRef.current;
    if (!c) { return; }
    composeQrImage(c, { title: 'Acceso autorizado', name: qr.visitor_name, validity, footer: 'Mostrá este código en la guardia' })
      .then((b) => alive && setBlob(b))
      .catch(() => alive && setMsg('No se pudo preparar la imagen del QR.'));
    return () => { alive = false; };
  }, [qr.token, qr.visitor_name, validity]);

  const onShare = async () => {
    if (!blob) { return; }
    const r = await shareImage(blob, filename, `QR de acceso para ${qr.visitor_name}. ${validity}.`);
    setMsg(r === 'downloaded' ? 'Imagen descargada. Enviala por WhatsApp u otra app desde tu galería o carpeta de descargas.' : '');
  };

  return (
    <div className="card flex flex-col items-center gap-3 text-center">
      <QRCodeCanvas ref={canvasRef} value={qr.token} size={480} marginSize={2} level="M"
        className="h-auto w-full max-w-[240px] rounded-lg" role="img" aria-label={`Código QR de acceso para ${qr.visitor_name}`} />
      <div className="font-medium">{qr.visitor_name}</div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{validity}</div>

      <div className="grid w-full gap-2 sm:grid-cols-2">
        <button type="button" onClick={onShare} disabled={!blob}
          className="btn min-h-11 bg-[#25D366] text-[#0b3d1f] hover:bg-[#1ebe5b] sm:col-span-2">
          <Icon name="message" />
          {shareable ? 'Enviar por WhatsApp' : 'Descargar para WhatsApp'}
        </button>
        {shareable && (
          <button type="button" className="btn-secondary min-h-11 sm:col-span-2" disabled={!blob} onClick={() => saveBlob(blob, filename)}>
            <Icon name="down" /> Descargar imagen
          </button>
        )}
      </div>
      {shareable && <p className="text-xs text-slate-500 dark:text-slate-400">Se abre el menú de compartir de tu dispositivo: elegí WhatsApp o cualquier otra app.</p>}
      {msg && <p role="status" className="text-sm text-slate-600 dark:text-slate-300">{msg}</p>}
    </div>
  );
}
