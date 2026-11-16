import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [
    react(),
    !isSsrBuild && VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      manifest: {
        name: 'AdminCountrys',
        short_name: 'Country',
        description: 'Gestión de barrios cerrados',
        theme_color: '#0f766e',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  server: {
    host: true, // accesible desde el celular en la red local
    // Socket.IO no pasa por acá: en desarrollo se conecta directo al backend (ver src/lib/auth.jsx)
    proxy: {
      '/uploads/tenants': 'http://127.0.0.1:4000',
      '/api': {
        target: 'http://127.0.0.1:4000', // 127.0.0.1 evita que "localhost" resuelva a IPv6 en Windows
        configure: (proxy) => {
          // Backend caído o reiniciándose: 503 con mensaje claro en vez de un stack trace
          proxy.on('error', (err, req, res) => {
            if (res.headersSent || !res.writeHead) { return; }
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'El backend no está disponible (¿se está reiniciando?). Reintentá en unos segundos.' }));
          });
        },
      },
    },
  },
}));
