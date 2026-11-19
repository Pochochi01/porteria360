import { lazy, Suspense, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { api } from './lib/api';
import { brandStyle } from './theme/brand';
import { ThemeToggle } from './components/ThemeToggle';
import { homeFor } from './lib/roleHome';
import { useServiceWorkerNavigation, useUnreadNotifications } from './hooks/useNotifications';

// Invitación a instalar y a activar notificaciones: chunk propio, fuera del camino crítico
const AppPrompts = lazy(() => import('./components/AppPrompts').then((m) => ({ default: m.AppPrompts })));

// Code splitting: cada pantalla es un chunk propio
const LandingPage = lazy(() => import('./landing/LandingPage'));
const TenantPublic = lazy(() => import('./pages/TenantPublic'));
const Login = lazy(() => import('./pages/Login'));
const AdminUsers = lazy(() => import('./pages/AdminUsers'));
const Branding = lazy(() => import('./pages/Branding'));
const Household = lazy(() => import('./pages/Household'));
const GuardAccess = lazy(() => import('./pages/GuardAccess'));
const ResidentVisits = lazy(() => import('./pages/ResidentVisits'));
const GuardRound = lazy(() => import('./pages/GuardRound'));
const RoundsBoard = lazy(() => import('./pages/RoundsBoard'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Reservations = lazy(() => import('./pages/Reservations'));
const Emergencies = lazy(() => import('./pages/Emergencies'));
const Platform = lazy(() => import('./pages/Platform'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Announcements = lazy(() => import('./pages/Announcements'));

const RES = ['owner', 'family', 'resident'];
const EVERYONE = ['admin', 'supervisor', 'guard', ...RES];
const MENU = [
  { to: '/plataforma', label: 'Complejos', roles: ['superadmin'], only: true, el: <Platform /> },
  { to: '/admin', label: 'Usuarios', roles: ['admin'], el: <AdminUsers /> },
  { to: '/branding', label: 'Identidad y galería', roles: ['admin'], el: <Branding /> },
  { to: '/familia', label: 'Mi familia', roles: ['owner'], el: <Household /> },
  { to: '/guardia', label: 'Accesos', roles: ['guard', 'supervisor', 'admin'], el: <GuardAccess /> },
  { to: '/visitas', label: 'Visitas', roles: RES, el: <ResidentVisits /> },
  { to: '/ronda', label: 'Mi ronda', roles: ['guard'], el: <GuardRound /> },
  { to: '/rondas', label: 'Rondas', roles: ['supervisor', 'admin'], el: <RoundsBoard /> },
  { to: '/expensas', label: 'Expensas', roles: ['admin', 'owner', 'family'], el: <Expenses /> },
  { to: '/reservas', label: 'Reservas', roles: ['admin', ...RES], el: <Reservations /> },
  { to: '/emergencias', label: 'Emergencias', roles: ['admin', 'supervisor', 'guard', ...RES], el: <Emergencies /> },
  { to: '/comunicados', label: 'Comunicados', roles: EVERYONE, el: <Announcements /> },
  { to: '/notificaciones', label: 'Notificaciones', roles: EVERYONE, el: <Notifications />, badge: 'unread' },
];

const Loading = () => (
  <div className="grid min-h-[50vh] place-items-center" role="status" aria-live="polite">
    <span className="h-6 w-6 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
    <span className="sr-only">Cargando…</span>
  </div>
);

/** Panel autenticado, con el branding del complejo aplicado a toda la sesión. */
function AppShell() {
  const { user, logout, is, inTenant, backToPlatform } = useAuth();
  const [brand, setBrand] = useState(null);
  const unread = useUnreadNotifications();
  useServiceWorkerNavigation();

  useEffect(() => {
    api.get('/branding/current').then((r) => setBrand(r.data)).catch(() => {});
    const onUpdate = (e) => setBrand(e.detail);
    window.addEventListener('branding:updated', onUpdate);
    return () => window.removeEventListener('branding:updated', onUpdate);
  }, [user]);

  // Superadmin en la plataforma: solo ve "Complejos"; dentro de un complejo, el menú de admin
  const items = MENU.filter((m) => is(...m.roles) && (inTenant ? !m.only : !is('superadmin') || m.only));
  const s = brand?.settings;
  const home = homeFor(user.roles, items.map((m) => m.to));

  return (
    <div className="min-h-screen overflow-x-clip md:flex" style={brandStyle(s)}>
      <aside className="bg-brand-800 text-white md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 dark:bg-slate-900 dark:md:border-r dark:md:border-white/10">
        <div className="flex items-center justify-between gap-2 p-4">
          <span className="flex min-w-0 items-center gap-2 font-display font-bold">
            {s?.logo_url && <img src={s.logo_url} alt="" className="h-8 w-8 shrink-0 rounded-md bg-white object-contain p-0.5" />}
            <span className="truncate">{s?.display_name || 'AdminCountrys'}</span>
          </span>
          <span className="flex items-center gap-2 md:hidden">
            <ThemeToggle className="!h-8 !w-8 border-white/20 bg-white/10 text-white" />
            <button onClick={logout} className="touch-target px-1 text-xs underline">Salir</button>
          </span>
        </div>
        <nav aria-label="Panel" className="no-scrollbar flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
          {items.map((m) => (
            <NavLink key={m.to} to={m.to}
              className={({ isActive }) => `touch-target relative flex items-center whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors duration-150 ${
                isActive ? 'bg-black/25 font-medium dark:bg-white/10' : 'text-white/85 hover:bg-white/10'}`}>
              {m.label}
              {m.badge === 'unread' && unread > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-400 px-1.5 text-[11px] font-bold leading-5 text-slate-900">
                  {unread > 99 ? '99+' : unread}<span className="sr-only"> sin leer</span>
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="hidden p-4 text-xs md:block">
          <div className="mb-3 flex items-center justify-between">
            <span className="truncate">{user.full_name}</span>
            <ThemeToggle className="!h-8 !w-8 border-white/20 bg-white/10 text-white hover:bg-white/20" />
          </div>
          <button onClick={logout} className="underline">Cerrar sesión</button>
        </div>
      </aside>
      {/* min-w-0: una tabla ancha hace scroll dentro de su tarjeta, nunca ensancha la página */}
      <main className="mx-auto w-full min-w-0 max-w-5xl flex-1 p-4 pb-safe">
        {inTenant && (
          <div className="mb-4 flex items-center justify-between rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
            Estás administrando un complejo como superadmin.
            <button className="underline" onClick={backToPlatform}>Volver a Complejos</button>
          </div>
        )}
        <Suspense fallback={<Loading />}>
          <Routes>
            {items.map((m) => <Route key={m.to} path={m.to} element={m.el} />)}
            {/* /panel (inicio de sesión y app instalada) y rutas desconocidas → pantalla inicial del perfil */}
            <Route path="*" element={<Navigate to={home} replace />} />
          </Routes>
        </Suspense>
      </main>
      <Suspense fallback={null}><AppPrompts /></Suspense>
    </div>
  );
}

/** @param {{ landing?: import('react').ReactNode }} props landing: solo para el prerender (componente ya cargado) */
export default function App({ landing }) {
  const { user, loading } = useAuth();
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={landing || <LandingPage />} />
        <Route path="/c/:slug" element={<TenantPublic />} />
        <Route path="/login" element={loading ? <Loading /> : user ? <Navigate to="/panel" replace /> : <Login />} />
        <Route path="/*" element={loading ? <Loading /> : user ? <AppShell /> : <Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}
