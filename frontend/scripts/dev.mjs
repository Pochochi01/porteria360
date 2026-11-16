// npm run dev: levanta Vite y, si el backend no está corriendo en :4000, también lo levanta.
// Evita el "http proxy error: ECONNRESET/ECONNREFUSED" de Vite cuando solo se inicia el frontend.
import { spawn } from 'node:child_process';
import path from 'node:path';

const API = `http://127.0.0.1:${process.env.VITE_API_PORT || 4000}/api/health`;
const ROOT = path.resolve(import.meta.dirname, '..');
const children = [];

const run = (cmd, args, cwd, name) => {
  const p = spawn(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  p.on('exit', (code) => {
    if (code && code !== 0) { console.error(`\n[${name}] terminó con código ${code}`); }
    shutdown(code ?? 0);
  });
  children.push(p);
};

function shutdown(code) {
  for (const c of children) { if (!c.killed) { c.kill(); } }
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const up = async () => {
  try { return (await fetch(API, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
};

if (await up()) {
  console.log('✓ Backend ya en ejecución en :4000');
} else {
  console.log('→ Backend no detectado: iniciándolo (backend/npm run dev)…');
  run('npm', ['run', 'dev'], path.resolve(ROOT, '../backend'), 'api');
  // Espera a que responda antes de abrir Vite (máx. 30 s)
  let ok = false;
  for (let i = 0; i < 60 && !ok; i++) { await new Promise((r) => { setTimeout(r, 500); }); ok = await up(); }
  console.log(ok ? '✓ Backend listo' : '⚠ El backend no respondió en 30 s: revisá los mensajes de arriba (.env, MySQL).');
}
run('npx', ['vite', ...process.argv.slice(2)], ROOT, 'web');
