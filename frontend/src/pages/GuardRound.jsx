import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errMsg } from '../lib/api';
import { GEO_ERRORS } from '../lib/geo';
import { useGeolocation } from '../hooks/useGeolocation';
import { Alert, PageTitle, Status } from '../components/ui';
import { fmtDate } from '../lib/format';
import QrScanner from '../components/QrScanner';

// Resultado de un escaneo (el estado lo decide el backend; acá solo se muestra)
const RESULT = {
  valid: { title: 'Punto registrado correctamente', tone: 'ok', icon: '✅' },
  out_of_range: { title: 'Fuera del radio permitido', tone: 'warn', icon: '⚠' },
  gps_inaccurate: { title: 'Precisión GPS insuficiente', tone: 'warn', icon: '⚠' },
  gps_disabled: { title: 'Active la ubicación para registrar el punto', tone: 'warn', icon: '⚠' },
  gps_denied: { title: 'Permiso de ubicación denegado', tone: 'bad', icon: '⚠' },
  location_error: { title: 'No se pudo obtener la ubicación', tone: 'warn', icon: '⚠' },
  point_unlocated: { title: 'Punto sin ubicación configurada', tone: 'warn', icon: '⚠' },
  error: { title: 'No se pudo registrar', tone: 'bad', icon: '✕' },
};
const TONE = {
  ok: 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200',
  warn: 'border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200',
  bad: 'border-red-500 bg-red-50 text-red-900 dark:bg-red-500/10 dark:text-red-200',
};

function GpsStatus({ geo, maxAccuracy }) {
  if (geo.unsupported) { return <Alert msg={GEO_ERRORS[geo.unsupported]} />; }
  const denied = geo.permission === 'denied';
  const ok = geo.state === 'ready' && geo.fix?.accuracy <= maxAccuracy;
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 text-sm ${ok ? 'border-emerald-300 dark:border-emerald-700' : 'border-slate-200 dark:border-slate-700'}`}>
      <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${ok ? 'bg-emerald-500' : denied ? 'bg-red-500' : 'bg-amber-500'}`} />
      <span className="min-w-0 flex-1">
        {denied ? 'Ubicación bloqueada: habilítela en los ajustes del navegador.'
          : geo.state === 'locating' ? `Buscando señal GPS…${geo.fix ? ` ±${Math.round(geo.fix.accuracy)} m` : ''}`
            : ok ? `GPS listo · ±${Math.round(geo.fix.accuracy)} m`
              : geo.permission === 'granted' ? 'Ubicación permitida. Se medirá al escanear cada punto.'
                : 'La ronda necesita su ubicación para validar cada punto.'}
      </span>
      {!ok && !denied && geo.state !== 'locating' && (
        <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={geo.acquire}>Activar ubicación</button>
      )}
    </div>
  );
}

export default function GuardRound() {
  const [round, setRound] = useState(undefined);
  const [scanning, setScanning] = useState(false);
  const [nfc, setNfc] = useState(false);
  const [msg, setMsg] = useState({});
  const [phase, setPhase] = useState(null); // { tag, step: 'locating'|'sending' }
  const [result, setResult] = useState(null); // { status, message, tag, distance_m, accuracy_m, checkpoint }
  const maxAccuracy = round?.geo?.max_accuracy_m ?? 50;
  const geo = useGeolocation({ maxAccuracy, timeout: 20000 });
  const busy = useRef(false);

  useEffect(() => { api.get('/rounds/current').then((r) => setRound(r.data)).catch((e) => setMsg({ error: errMsg(e) })); }, []);

  // Escaneo → ubicación obligatoria → backend valida. Sin ubicación igual se informa (queda auditado) y el backend rechaza.
  const mark = useCallback(async (tag_code, method) => {
    if (busy.current || !round) { return; }
    busy.current = true;
    setScanning(false);
    setResult(null);
    setMsg({});
    try {
      setPhase({ tag: tag_code, method, step: 'locating' });
      const loc = await geo.acquire();
      setPhase({ tag: tag_code, method, step: 'sending' });
      const body = { tag_code, method, ...(loc.ok ? { position: loc.fix } : { geo_error: loc.error }) };
      try {
        const { data } = await api.post(`/rounds/${round.id}/scan`, body);
        setRound(data);
        setResult({ ...data.scan, status: 'valid' });
        navigator.vibrate?.(150);
      } catch (err) {
        const d = err.response?.data || {};
        setResult({ status: d.status || 'error', message: errMsg(err), distance_m: d.distance_m, accuracy_m: d.accuracy_m, radius_m: d.radius_m,
          retry: { tag_code, method }, localError: loc.ok ? null : loc.error });
        navigator.vibrate?.([80, 60, 80]);
      }
    } finally {
      setPhase(null);
      busy.current = false;
    }
  }, [round, geo]);

  // Referencia estable: el lector QR no se reinicia en cada render
  const markRef = useRef(mark);
  markRef.current = mark;
  const onQr = useCallback((t) => markRef.current(t, 'qr'), []);

  // Web NFC (Chrome Android)
  const startNfc = async () => {
    if (!('NDEFReader' in window)) { return setMsg({ error: 'Este dispositivo no soporta NFC web. Use QR.' }); }
    try {
      const reader = new window.NDEFReader();
      await reader.scan();
      setNfc(true);
      reader.onreading = (ev) => {
        const rec = ev.message.records.find((r) => r.recordType === 'text');
        const code = rec ? new TextDecoder(rec.encoding || 'utf-8').decode(rec.data) : ev.serialNumber;
        markRef.current(code, 'nfc');
      };
    } catch (err) {
      setMsg({ error: `No se pudo activar NFC: ${err.message}` });
    }
  };

  const start = async () => {
    try {
      setRound((await api.post('/rounds/start', { expected_minutes: 60 })).data);
      setMsg({});
      geo.acquire(); // pide el permiso con el toque de "Iniciar ronda" (iOS lo exige) y calienta el GPS
    } catch (err) { setMsg({ error: errMsg(err) }); }
  };
  const finish = async () => {
    try { const { data } = await api.post(`/rounds/${round.id}/finish`); setMsg({ ok: `Ronda ${data.status === 'completed' ? 'completa' : 'incompleta'}` }); setRound(null); setResult(null); } catch (err) { setMsg({ error: errMsg(err) }); }
  };

  if (round === undefined) { return <p>Cargando…</p>; }
  const done = round?.points.filter((p) => p.scanned_at).length ?? 0;
  const res = result && (RESULT[result.status] || RESULT.error);

  return (
    <div className="space-y-4">
      <PageTitle>Mi ronda</PageTitle>
      <Alert msg={msg.error} />
      <Alert msg={msg.ok} type="ok" />
      {scanning && <QrScanner onScan={onQr} onClose={() => setScanning(false)} />}

      {!round ? (
        <button className="btn-primary w-full py-4 text-lg" onClick={start}>Iniciar ronda</button>
      ) : (
        <>
          <div className="card">
            <div className="flex items-center justify-between">
              <span>Iniciada {fmtDate(round.started_at)}</span><Status s={round.status} />
            </div>
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div className="h-full bg-brand-600" style={{ width: `${(done / round.points.length) * 100}%` }} />
            </div>
            <p className="mt-1 text-sm text-slate-500">{done} de {round.points.length} puntos</p>
          </div>

          <GpsStatus geo={geo} maxAccuracy={maxAccuracy} />

          {phase && (
            <div role="status" aria-live="polite" className="card flex items-center gap-3">
              <span aria-hidden className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
              <div className="min-w-0">
                <div className="font-semibold">{phase.step === 'locating' ? 'Verificando su ubicación…' : 'Validando el punto…'}</div>
                {phase.step === 'locating' && (
                  <div className="text-sm text-slate-500">
                    {geo.fix ? `Precisión actual ±${Math.round(geo.fix.accuracy)} m (se necesita ±${maxAccuracy} m o menos)` : 'Esperando señal GPS. Si se le pide, permita el acceso a la ubicación.'}
                  </div>
                )}
              </div>
            </div>
          )}

          {res && !phase && (
            <section role="alert" className={`rounded-xl border-l-4 p-4 ${TONE[res.tone]}`}>
              <h2 className="text-lg font-bold"><span aria-hidden>{res.icon} </span>{res.title}</h2>
              {result.checkpoint && <p className="font-medium">{result.checkpoint}</p>}
              {result.status !== 'valid' && <p className="mt-1 text-sm">{result.localError && !result.message ? GEO_ERRORS[result.localError] : result.message}</p>}
              {(result.distance_m != null || result.accuracy_m != null) && (
                <p className="mt-1 text-xs opacity-80">
                  {result.distance_m != null && <>Distancia al punto: {result.distance_m} m{result.radius_m ? ` (permitido ${result.radius_m} m)` : ''}</>}
                  {result.distance_m != null && result.accuracy_m != null && ' · '}
                  {result.accuracy_m != null && <>Precisión GPS: ±{Math.round(result.accuracy_m)} m</>}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {result.retry && result.status !== 'error' && (
                  <button type="button" className="btn-primary" onClick={() => mark(result.retry.tag_code, result.retry.method)}>Reintentar este punto</button>
                )}
                <button type="button" className="btn-secondary" onClick={() => setResult(null)}>Cerrar</button>
              </div>
            </section>
          )}

          <div className="grid grid-cols-2 gap-3">
            <button className="btn-primary py-4" disabled={!!phase || !!geo.unsupported} onClick={() => { setResult(null); setScanning(true); }}>Escanear QR</button>
            <button className="btn-secondary py-4" onClick={startNfc} disabled={nfc || !!geo.unsupported}>{nfc ? 'NFC activo: acerque el tag' : 'Leer NFC'}</button>
          </div>
          <ul className="card divide-y dark:divide-slate-800">
            {round.points.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">{p.scanned_at ? '✅' : '⬜'} {p.name}
                  {p.cp_lat == null && <span className="ml-1 text-xs text-amber-700 dark:text-amber-300">(sin ubicación)</span>}</span>
                <span className="shrink-0 text-right text-slate-500">
                  {p.scanned_at ? <>{fmtDate(p.scanned_at)}{p.distance_m != null && <span className="block text-xs">a {Math.round(p.distance_m)} m</span>}</> : ''}
                </span>
              </li>
            ))}
          </ul>
          <button className="btn-danger w-full" onClick={finish}>Finalizar ronda</button>
        </>
      )}
    </div>
  );
}
