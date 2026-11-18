// PM2: mantiene el backend corriendo, lo reinicia si se cae y al reiniciar el VPS.
// Uso (desde cualquier carpeta):  pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup
// El backend resuelve .env, uploads/ y frontend/dist desde su propia ubicación (src/lib/paths.js),
// así que no depende del cwd; igual se fija cwd = backend por prolijidad de logs y herramientas.
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'porteria360',
      cwd: path.join(ROOT, 'backend'),
      script: path.join(ROOT, 'backend', 'src', 'server.js'),
      instances: 1, // Socket.IO y el job de rondas asumen una sola instancia
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '700M',
      kill_timeout: 12000, // da tiempo al apagado ordenado (SIGINT: cierra conexiones, MySQL y OCR)
      time: true,
      out_file: path.join(ROOT, 'logs', 'app.out.log'),
      error_file: path.join(ROOT, 'logs', 'app.err.log'),
    },
  ],
};
