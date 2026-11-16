import { useCallback, useEffect, useState } from 'react';
import { api, errMsg } from '../lib/api';
import { currentPosition } from '../lib/geo';
import { Alert, PageTitle, Status } from '../components/ui';
import { fmtDate } from '../lib/format';
import QrScanner from '../components/QrScanner';


export default function GuardRound() {
  const [round, setRound] = useState(undefined);
  const [scanning, setScanning] = useState(false);
  const [nfc, setNfc] = useState(false);
  const [msg, setMsg] = useState({});

  useEffect(() => { api.get('/rounds/current').then((r) => setRound(r.data)); }, []);

  const mark = useCallback(async (tag_code, method) => {
    setScanning(false);
    try {
      const { data } = await api.post(`/rounds/${round.id}/scan`, { tag_code, method, ...(await currentPosition(5000)) });
      setRound(data);
      setMsg({ ok: 'Punto registrado' });
      navigator.vibrate?.(150);
    } catch (err) {
      setMsg({ error: errMsg(err) });
    }
  }, [round]);

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
        mark(code, 'nfc');
      };
    } catch (err) {
      setMsg({ error: `No se pudo activar NFC: ${  err.message}` });
    }
  };

  const start = async () => {
    try { setRound((await api.post('/rounds/start', { expected_minutes: 60 })).data); setMsg({}); } catch (err) { setMsg({ error: errMsg(err) }); }
  };
  const finish = async () => {
    try { const { data } = await api.post(`/rounds/${round.id}/finish`); setMsg({ ok: `Ronda ${data.status === 'completed' ? 'completa' : 'incompleta'}` }); setRound(null); } catch (err) { setMsg({ error: errMsg(err) }); }
  };

  if (round === undefined) { return <p>Cargando…</p>; }
  const done = round?.points.filter((p) => p.scanned_at).length ?? 0;

  return (
    <div className="space-y-4">
      <PageTitle>Mi ronda</PageTitle>
      <Alert msg={msg.error} />
      <Alert msg={msg.ok} type="ok" />
      {scanning && <QrScanner onScan={(t) => mark(t, 'qr')} onClose={() => setScanning(false)} />}

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
          <div className="grid grid-cols-2 gap-3">
            <button className="btn-primary py-4" onClick={() => setScanning(true)}>Escanear QR</button>
            <button className="btn-secondary py-4" onClick={startNfc} disabled={nfc}>{nfc ? 'NFC activo: acerque el tag' : 'Leer NFC'}</button>
          </div>
          <ul className="card divide-y dark:divide-slate-800">
            {round.points.map((p) => (
              <li key={p.id} className="flex justify-between py-2 text-sm">
                <span>{p.scanned_at ? '✅' : '⬜'} {p.name}</span>
                <span className="text-slate-500">{p.scanned_at ? fmtDate(p.scanned_at) : ''}</span>
              </li>
            ))}
          </ul>
          <button className="btn-danger w-full" onClick={finish}>Finalizar ronda</button>
        </>
      )}
    </div>
  );
}
