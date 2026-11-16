import { api } from './api';

/** Pide un archivo con la sesión (Authorization) y devuelve un blob URL. Liberar con URL.revokeObjectURL. */
export async function fetchBlobUrl(url) {
  const r = await api.get(url, { responseType: 'blob' });
  return { url: URL.createObjectURL(r.data), type: r.data.type };
}

/** Descarga un archivo autenticado (reportes Excel/PDF, comprobantes). */
export async function downloadFile(url, filename) {
  const { url: blobUrl } = await fetchBlobUrl(url);
  const a = Object.assign(document.createElement('a'), { href: blobUrl, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
}
