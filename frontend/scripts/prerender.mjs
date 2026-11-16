// Inserta el HTML prerenderizado de la portada en dist/index.html.
// dist/app.html queda vacío para las rutas del panel (el servidor lo usa para todo lo que no sea "/").
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SSR = path.join(ROOT, 'dist-ssr');

const template = await fs.readFile(path.join(DIST, 'index.html'), 'utf8');
if (!template.includes('<div id="root"></div>')) { throw new Error('No se encontró <div id="root"></div> en dist/index.html'); }
await fs.writeFile(path.join(DIST, 'app.html'), template);

const { render } = await import(pathToFileURL(path.join(SSR, 'entry-prerender.js')).href);
const html = render('/');
await fs.writeFile(path.join(DIST, 'index.html'), template.replace('<div id="root"></div>', `<div id="root">${html}</div>`));
await fs.rm(SSR, { recursive: true, force: true });
console.log(`Portada prerenderizada: ${(html.length / 1024).toFixed(1)} KB de HTML`);
