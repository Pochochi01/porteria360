import { useEffect, useId } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

/** Lector QR con la cámara trasera. Llama onScan(texto) una vez y se detiene. */
export default function QrScanner({ onScan, onClose }) {
  const id = useId().replace(/:/g, '');
  useEffect(() => {
    const qr = new Html5Qrcode(id);
    let done = false;
    qr.start({ facingMode: 'environment' }, { fps: 10, qrbox: 240 }, (text) => {
      if (done) { return; }
      done = true;
      qr.stop().finally(() => onScan(text));
    }).catch(() => {});
    return () => { if (!done) { qr.stop().catch(() => {}); } };
  }, [id, onScan]);
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-4">
      <div id={id} className="w-full max-w-sm overflow-hidden rounded-xl bg-black" />
      <button className="btn-secondary mt-4" onClick={onClose}>Cancelar</button>
    </div>
  );
}
