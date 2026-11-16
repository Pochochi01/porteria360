// Entrada de prerender (build): genera el HTML de la portada para que se vea sin esperar al JavaScript.
// El árbol debe coincidir con el de main.jsx para que React pueda hidratarlo.
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { AuthProvider } from './lib/AuthProvider';
import { ThemeProvider } from './theme/ThemeProvider';
import App from './App';
import LandingPage from './landing/LandingPage';

export function render(url = '/') {
  return renderToString(
    <ThemeProvider>
      <StaticRouter location={url}>
        <AuthProvider>
          <App landing={<LandingPage />} />
        </AuthProvider>
      </StaticRouter>
    </ThemeProvider>
  );
}
