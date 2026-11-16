import { useEffect, useState } from 'react';
import { Modal } from './crud';
import { Icon } from './icons';
import { errMsg } from '../lib/api';
import { fetchBlobUrl } from '../lib/download';

/**
 * Visor de comprobantes privados (PDF o imagen) descargados con la sesión.
 * @param {{ url: string, title: string, filename: string, onClose: () => void }} props url de la API (p. ej. /expenditures/12/voucher)
 */
export function DocumentViewer({ url, title, filename, onClose }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let blobUrl;
    let cancelled = false;
    fetchBlobUrl(url)
      .then((f) => {
        blobUrl = f.url;
        if (cancelled) { URL.revokeObjectURL(f.url); } else { setFile(f); }
      })
      .catch((e) => !cancelled && setError(errMsg(e)));
    return () => { cancelled = true; if (blobUrl) { URL.revokeObjectURL(blobUrl); } };
  }, [url]);

  const isPdf = file?.type === 'application/pdf';
  return (
    <Modal title={title} onClose={onClose} wide>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!file && !error && <div className="grid h-64 place-items-center"><span className="h-6 w-6 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" /></div>}
      {file && (
        <div className="space-y-3">
          {isPdf
            ? <iframe src={file.url} title={title} className="h-[65vh] w-full rounded-lg border border-slate-200 dark:border-slate-700" />
            : <img src={file.url} alt={title} className="max-h-[65vh] w-full rounded-lg object-contain" />}
          <div className="flex flex-wrap justify-end gap-2">
            {/* En celulares el PDF embebido no siempre se ve: abrirlo en otra pestaña */}
            <a href={file.url} target="_blank" rel="noopener noreferrer" className="btn-secondary"><Icon name="external" className="h-4 w-4" />Abrir</a>
            <a href={file.url} download={filename} className="btn-primary"><Icon name="down" className="h-4 w-4" />Descargar</a>
          </div>
        </div>
      )}
    </Modal>
  );
}
