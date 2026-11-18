import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useSocketEvent } from '../lib/auth';

/** Al tocar una notificación con la app abierta, el service worker pide navegar: se hace con el router (sin recargar). */
export function useServiceWorkerNavigation() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!('serviceWorker' in navigator)) { return; }
    const onMessage = (e) => {
      const url = e.data?.type === 'navigate' && typeof e.data.url === 'string' ? e.data.url : null;
      if (url?.startsWith('/') && !url.startsWith('//')) { navigate(url); } // solo rutas internas
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);
}

/** Cantidad de notificaciones sin leer, en vivo (socket) y al volver a la app. */
export function useUnreadNotifications() {
  const [unread, setUnread] = useState(0);
  const refresh = useCallback(() => {
    api.get('/notifications/unread-count').then((r) => setUnread(r.data.unread)).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('notifications:changed', refresh);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('notifications:changed', refresh);
    };
  }, [refresh]);
  const onNew = useCallback(() => setUnread((n) => n + 1), []);
  useSocketEvent('notification:new', onNew);
  return unread;
}

/** Avisa al contador que cambió el estado de lectura (bandeja). */
export const notificationsChanged = () => window.dispatchEvent(new Event('notifications:changed'));
