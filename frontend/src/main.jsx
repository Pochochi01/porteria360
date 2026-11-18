import React from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './lib/AuthProvider';
import { ThemeProvider } from './theme/ThemeProvider';
import { applyInitialTheme } from './theme/theme';
import App from './App';
import './lib/pwa'; // captura beforeinstallprompt antes de que React monte
import './index.css';

applyInitialTheme(); // antes del primer render: sin destello claro→oscuro

// Fuentes sin bloquear el render (display=swap): el texto se ve de inmediato con la fuente del sistema
document.head.appendChild(Object.assign(document.createElement('link'), {
  rel: 'stylesheet',
  href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@600;700;800&display=swap',
}));


const tree = (
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
);

// La portada llega prerenderizada (scripts/prerender.mjs): se hidrata. El resto de las rutas se renderiza.
const root = document.getElementById('root');
if (location.pathname === '/' && root.hasChildNodes()) {
  // Hidratar recién después de la primera pintura: el HTML prerenderizado se ve aunque el JS ya haya llegado
  requestAnimationFrame(() => setTimeout(() => hydrateRoot(root, tree), 0));
} else { createRoot(root).render(tree); }
