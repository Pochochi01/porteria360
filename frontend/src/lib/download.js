import { api } from './api';

/** Pide un archivo con la sesión (Authorization) y devuelve un blob URL. Liberar con URL.revokeObjectURL. */
export async function fetchBlobUrl(url) {
  const r = await api.get(url, { responseType: 'blob' });
  return { url: URL.createObjectURL(r.data), type: r.data.type };
}

/** Guarda un archivo ya generado en el dispositivo (descarga del navegador). */
export function saveBlobUrl(blobUrl, filename) {
  const a = Object.assign(document.createElement('a'), { href: blobUrl, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** @param {Blob} blob @param {string} filename */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  saveBlobUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Descarga un archivo autenticado (reportes Excel/PDF, comprobantes). */
export async function downloadFile(url, filename) {
  const { url: blobUrl } = await fetchBlobUrl(url);
  saveBlobUrl(blobUrl, filename);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
}
