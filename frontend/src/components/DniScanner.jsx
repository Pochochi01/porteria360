import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { api, errMsg } from '../lib/api';
import { isInvitationToken, parseDniPdf417 } from '../lib/dni';
import { Icon } from './icons';

/** @typedef {import('../lib/dni').DniData} DniData */

const PDF417_TIMEOUT_MS = 15000; // sin PDF417 en este tiempo → modo OCR
const HINTS = new Map([
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.PDF_417, BarcodeFormat.QR_CODE]],
  [DecodeHintType.TRY_HARDER, true],
]);
const MSG = {
  scanning: 'Enfoque el código del DNI argentino',
  fallback: 'No se pudo leer el código del DNI. Se utilizará reconocimiento OCR.',
  ocr: 'Encuadrá el frente del DNI (o el dorso con las líneas <<<) y tocá "Capturar imagen".',
};

/** Registro sin datos personales (no bloquea el flujo si falla). */
const track = (event, extra = {}) => api.post('/dni/events', { event, ...extra }).catch(() => {});

/**
 * Lector de DNI argentino: PDF417 por cámara (principal) con fallback automático a OCR en el servidor.
 * También reconoce los QR de invitación del sistema.
 * @param {{ onResult: (d: { nombreCompleto: string, dni: string, data?: DniData }) => void,
 *           onInvitation?: (token: string) => void, onClose: () => void }} props
 */
export default function DniScanner({ onResult, onInvitation, onClose }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const readerRef = useRef(null);
  const timerRef = useRef(null);
  const startedAt = useRef(0);
  const handledRef = useRef(false);

  // idle → scanning → (confirm | ocr → processing → confirm | failed)
  const [phase, setPhase] = useState('idle');
  const [notice, setNotice] = useState(null); // { tone: 'ok' | 'warn' | 'error', text }
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [result, setResult] = useState(null); // { nombreCompleto, dni, data?, source }
  const [editing, setEditing] = useState(false);

  /** Detiene el decodificador y libera la cámara (tracks + srcObject). */
  const stopCamera = useCallback(() => {
    clearTimeout(timerRef.current);
    controlsRef.current?.stop();
    controlsRef.current = null;
    const v = videoRef.current;
    if (v?.srcObject) {
      v.srcObject.getTracks().forEach((t) => t.stop());
      v.srcObject = null;
    }
  }, []);

  const goOcr = useCallback((reason) => {
    setPhase('ocr');
    setNotice({ tone: 'warn', text: `⚠ ${MSG.fallback}` });
    track(reason === 'parse' ? 'pdf417_parse_error' : 'pdf417_timeout', { ms: Math.round(performance.now() - startedAt.current) });
    track('ocr_fallback');
  }, []);

  /** Procesa un texto decodificado (PDF417 del DNI o QR de invitación). */
  const handleText = useCallback((text, format) => {
    if (handledRef.current) { return; }
    if (format === BarcodeFormat.QR_CODE) {
      if (isInvitationToken(text) && onInvitation) {
        handledRef.current = true;
        stopCamera();
        onInvitation(text.trim());
      } else { setNotice({ tone: 'warn', text: 'Ese QR no es una invitación del sistema. Enfoque el código PDF417 del DNI.' }); }
      return;
    }
    const data = parseDniPdf417(text);
    if (!data) { return goOcr('parse'); }
    handledRef.current = true;
    stopCamera();
    track('pdf417_ok', { ms: Math.round(performance.now() - startedAt.current), formato: data.formato });
    setResult({ nombreCompleto: data.nombreCompleto, dni: data.dni, data, source: 'pdf417' });
    setNotice({ tone: 'ok', text: '✅ DNI leído correctamente' });
    setPhase('confirm');
  }, [goOcr, onInvitation, stopCamera]);

  /** @param {string} [camId] cámara elegida ('' = trasera / predeterminada) */
  const start = useCallback(async (camId = deviceId) => {
    stopCamera();
    handledRef.current = false;
    setResult(null);
    setEditing(false);
    setNotice(null);
    setPhase('scanning');
    try {
      readerRef.current ??= new BrowserMultiFormatReader(HINTS, { delayBetweenScanAttempts: 120 });
      const video = camId
        ? { deviceId: { exact: camId } }
        : { facingMode: { ideal: 'environment' } }; // cámara trasera en celulares
      controlsRef.current = await readerRef.current.decodeFromConstraints(
        { audio: false, video: { ...video, width: { ideal: 1920 }, height: { ideal: 1080 } } },
        videoRef.current,
        (res) => { if (res) { handleText(res.getText(), res.getBarcodeFormat()); } }
      );
      startedAt.current = performance.now();
      // Con permiso concedido ya se ven los nombres de las cámaras (selector en PC)
      BrowserMultiFormatReader.listVideoInputDevices().then(setDevices).catch(() => {});
      timerRef.current = setTimeout(() => { if (!handledRef.current) { goOcr('timeout'); } }, PDF417_TIMEOUT_MS);
    } catch (e) {
      stopCamera();
      setPhase('idle');
      const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
      track('camera_error', { detail: String(e?.name || 'error').slice(0, 80) });
      setNotice({ tone: 'error', text: denied
        ? '❌ Sin permiso para usar la cámara. Habilitalo en el navegador (requiere HTTPS) o cargá los datos a mano.'
        : '❌ No se pudo abrir la cámara. Verificá que no la esté usando otra aplicación.' });
    }
  }, [deviceId, goOcr, handleText, stopCamera]);

  /** Captura un frame: primero intenta PDF417 sobre la foto completa; si no, OCR en el servidor. */
  const capture = async () => {
    const v = videoRef.current;
    if (!v?.videoWidth) { return; }
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0);
    try {
      const res = readerRef.current.decodeFromCanvas(canvas);
      if (res) { return handleText(res.getText(), res.getBarcodeFormat()); }
    } catch { /* sin código en la foto: sigue con OCR */ }

    handledRef.current = true;
    stopCamera();
    setPhase('processing');
    setNotice(null);
    try {
      const blob = await new Promise((ok) => { canvas.toBlob(ok, 'image/jpeg', 0.92); });
      const fd = new FormData();
      fd.append('image', blob, 'dni.jpg');
      const { data } = await api.post('/dni/ocr', fd);
      if (data.found) {
        setResult({ nombreCompleto: data.nombreCompleto, dni: data.dni, source: 'ocr' });
        setNotice({ tone: 'ok', text: '✅ DNI leído correctamente (OCR). Revisá los datos antes de confirmar.' });
        setPhase('confirm');
      } else {
        setResult({ nombreCompleto: data.nombreCompleto || '', dni: data.dni || '', source: 'ocr' });
        setEditing(true);
        setNotice({ tone: 'error', text: '❌ No fue posible identificar los datos del DNI. Completalos manualmente o reintentá.' });
        setPhase('confirm');
      }
    } catch (err) {
      setNotice({ tone: 'error', text: `❌ ${errMsg(err)}` });
      setPhase('failed');
    }
  };

  const manual = () => {
    stopCamera();
    handledRef.current = true;
    track('manual');
    setResult({ nombreCompleto: '', dni: '', source: 'manual' });
    setEditing(true);
    setNotice(null);
    setPhase('confirm');
  };

  const confirm = (e) => {
    e.preventDefault();
    const nombreCompleto = result.nombreCompleto.replace(/\s+/g, ' ').trim().toUpperCase();
    const dni = result.dni.replace(/\D/g, '');
    if (nombreCompleto.length < 2 || !/^\d{7,8}$/.test(dni)) {
      setNotice({ tone: 'error', text: '❌ Revisá los datos: el nombre es obligatorio y el DNI debe tener 7 u 8 dígitos.' });
      setEditing(true);
      return;
    }
    onResult({ nombreCompleto, dni, data: result.data });
  };

  // Liberar la cámara al desmontar y si la pestaña queda oculta
  useEffect(() => {
    const onHide = () => { if (document.hidden && controlsRef.current) { stopCamera(); setPhase('idle'); } };
    document.addEventListener('visibilitychange', onHide);
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('keydown', esc);
      document.body.style.overflow = overflow;
      stopCamera();
    };
  }, [onClose, stopCamera]);

  const showCamera = phase === 'scanning' || phase === 'ocr';
  const toneClass = { ok: 'bg-emerald-500/15 text-emerald-200', warn: 'bg-amber-500/15 text-amber-200', error: 'bg-red-500/15 text-red-200' };

  return (
    <div role="dialog" aria-modal="true" aria-label="Escanear DNI" className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white">
      <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
        <h2 className="font-display text-lg font-bold">Escanear DNI</h2>
        <div className="flex items-center gap-2">
          {devices.length > 1 && showCamera && (
            <select aria-label="Cámara" value={deviceId} onChange={(e) => { setDeviceId(e.target.value); start(e.target.value); }}
              className="max-w-[45vw] rounded-lg border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white">
              <option value="" className="text-slate-900">Cámara trasera / predeterminada</option>
              {devices.map((d, i) => <option key={d.deviceId} value={d.deviceId} className="text-slate-900">{d.label || `Cámara ${i + 1}`}</option>)}
            </select>
          )}
          <button type="button" onClick={onClose} aria-label="Cancelar" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 hover:bg-white/20"><Icon name="x" /></button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* El <video> existe siempre para que ZXing lo reutilice (una sola instancia de cámara) */}
        <video ref={videoRef} playsInline muted autoPlay
          className={`absolute inset-0 h-full w-full object-cover ${showCamera ? '' : 'hidden'}`} />

        {showCamera && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-6">
            {/* Guía de encuadre: proporción del DNI (85,6 × 54 mm) */}
            <div className={`relative aspect-[1.586] w-full max-w-xl rounded-2xl border-2 shadow-[0_0_0_100vmax_rgb(2_6_23/0.55)] ${phase === 'ocr' ? 'border-amber-400' : 'border-emerald-400'}`}>
              {phase === 'scanning' && (
                <>
                  <div className="absolute inset-x-6 bottom-[14%] h-[26%] rounded-lg border border-dashed border-white/60" />
                  <span className="absolute inset-x-6 bottom-[27%] h-0.5 animate-pulse bg-emerald-400/80" />
                </>
              )}
            </div>
            <p className="mt-5 max-w-md text-center text-base font-medium drop-shadow">{phase === 'ocr' ? MSG.ocr : MSG.scanning}</p>
          </div>
        )}

        {phase === 'idle' && (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <span className="grid h-20 w-20 place-items-center rounded-3xl bg-white/10"><Icon name="camera" className="h-9 w-9" /></span>
            <p className="max-w-sm text-lg">{MSG.scanning}</p>
            <p className="max-w-sm text-sm text-white/60">Se lee el código PDF417 del dorso del DNI. Si no se puede, se usa reconocimiento de texto.</p>
          </div>
        )}

        {phase === 'processing' && (
          <div className="flex h-full flex-col items-center justify-center gap-4" role="status">
            <span className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
            <p>Leyendo el DNI…</p>
          </div>
        )}

        {phase === 'confirm' && result && (
          <form onSubmit={confirm} className="mx-auto flex h-full w-full max-w-md flex-col justify-center gap-4 p-6">
            <h3 className="text-center text-lg font-semibold">{editing ? 'Completar datos' : 'Datos detectados'}</h3>
            <label className="block">
              <span className="mb-1 block text-xs text-white/60">Nombre completo (APELLIDO NOMBRE)</span>
              <input value={result.nombreCompleto} readOnly={!editing} required autoComplete="off"
                onChange={(e) => setResult((r) => ({ ...r, nombreCompleto: e.target.value }))}
                className={`w-full rounded-xl border px-4 py-3 text-lg font-semibold uppercase ${editing ? 'border-white/30 bg-white/10' : 'border-transparent bg-white/5'}`} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-white/60">DNI</span>
              <input value={result.dni} readOnly={!editing} required inputMode="numeric" autoComplete="off" maxLength={10}
                onChange={(e) => setResult((r) => ({ ...r, dni: e.target.value.replace(/[^\d.]/g, '') }))}
                className={`w-full rounded-xl border px-4 py-3 font-mono text-lg tracking-wider ${editing ? 'border-white/30 bg-white/10' : 'border-transparent bg-white/5'}`} />
            </label>
            {result.data && (
              <dl className="grid grid-cols-2 gap-2 rounded-xl bg-white/5 p-3 text-xs text-white/70">
                {[['Sexo', result.data.sexo], ['Nacimiento', result.data.fechaNacimiento], ['Emisión', result.data.fechaEmision],
                  ['Vencimiento', result.data.fechaVencimiento], ['Trámite', result.data.numeroTramite], ['Ejemplar', result.data.ejemplar]]
                  .filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="text-white/50">{k}</dt><dd className="font-medium text-white">{v}</dd></div>)}
              </dl>
            )}
            <p className="text-center text-xs text-white/50">Origen: {result.source === 'pdf417' ? 'código PDF417' : result.source === 'ocr' ? 'reconocimiento OCR' : 'carga manual'}</p>
            <div className="grid gap-2">
              <button className="btn-primary h-12 text-base">Confirmar datos</button>
              {!editing && <button type="button" className="btn-secondary h-11" onClick={() => setEditing(true)}>Corregir manualmente</button>}
              <button type="button" className="btn h-11 bg-white/10 text-white hover:bg-white/20" onClick={() => start()}>Reintentar escaneo</button>
            </div>
          </form>
        )}
      </div>

      {notice && phase !== 'confirm' && <p role="status" className={`mx-4 mb-2 rounded-xl px-4 py-3 text-sm ${toneClass[notice.tone]}`}>{notice.text}</p>}
      {notice && phase === 'confirm' && <p role="status" className={`mx-auto mb-2 w-full max-w-md rounded-xl px-4 py-3 text-sm ${toneClass[notice.tone]}`}>{notice.text}</p>}

      {phase !== 'confirm' && (
        <footer className="grid grid-cols-2 gap-2 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex sm:justify-center">
          {phase === 'idle' && <button type="button" className="btn-primary col-span-2 h-12 text-base sm:px-8" onClick={() => start()}>Iniciar escaneo</button>}
          {showCamera && <button type="button" className="btn-primary h-12 text-base sm:px-8" onClick={capture}><Icon name="camera" className="h-5 w-5" />Capturar imagen</button>}
          {(showCamera || phase === 'failed') && <button type="button" className="btn h-12 bg-white/10 text-white hover:bg-white/20 sm:px-6" onClick={() => start()}>Reintentar</button>}
          {phase !== 'processing' && <button type="button" className="btn h-12 bg-white/10 text-white hover:bg-white/20 sm:px-6" onClick={manual}>Cargar a mano</button>}
          <button type="button" className="btn h-12 bg-white/10 text-white hover:bg-white/20 sm:px-6" onClick={onClose}>Cancelar</button>
        </footer>
      )}
    </div>
  );
}
