import { useEffect, useState } from 'react';
import { api } from './api';
import { syncPush, unlinkPush } from './push';
import { AuthCtx } from './auth';

/**
 * Producción: mismo origen que la app. Desarrollo: directo al backend, no por el proxy WS de Vite
 * (que corta con ECONNRESET cada vez que el backend se reinicia).
 */
const socketUrl = () =>
  import.meta.env.VITE_SOCKET_URL ||
  (import.meta.env.DEV ? `${location.protocol}//${location.hostname}:${import.meta.env.VITE_API_PORT || 4000}` : '/');

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => typeof window !== 'undefined' && !!localStorage.getItem('token'));
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (!localStorage.getItem('token')) { return; }
    api.get('/auth/me').then((r) => setUser(r.data)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) { return; }
    let s;
    let cancelled = false;
    // socket.io-client se carga recién al iniciar sesión (no pesa en la landing)
    import('socket.io-client').then(({ io }) => {
      if (cancelled) { return; }
      s = io(socketUrl(), {
        auth: { token: localStorage.getItem('token') },
        transports: ['websocket', 'polling'],
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
      });
      // Token inválido o vencido: no tiene sentido reintentar (la API redirige al login)
      s.on('connect_error', (err) => {
        if (err.data?.code === 'unauthorized' || err.message === 'unauthorized') { s.disconnect(); }
      });
      setSocket(s);
    });
    syncPush().catch(() => {}); // solo renueva si ya hay permiso: nunca pide permiso sin un gesto del usuario
    return () => { cancelled = true; s?.disconnect(); };
  }, [user]);

  const login = async (tenant, email, password) => {
    const { data } = await api.post('/auth/login', { tenant, email, password });
    localStorage.setItem('token', data.token);
    setUser(data.user);
  };
  const logout = async () => {
    await unlinkPush(); // este dispositivo deja de recibir los avisos de esta cuenta (con el token todavía válido)
    localStorage.removeItem('token');
    localStorage.removeItem('platformToken');
    setUser(null);
  };

  // Superadmin: entrar a un complejo como admin y volver a la plataforma
  const enterTenant = async (tenantId) => {
    const { data } = await api.post(`/platform/tenants/${tenantId}/enter`);
    localStorage.setItem('platformToken', localStorage.getItem('token'));
    localStorage.setItem('token', data.token);
    window.location.href = '/admin';
  };
  const backToPlatform = () => {
    localStorage.setItem('token', localStorage.getItem('platformToken'));
    localStorage.removeItem('platformToken');
    window.location.href = '/plataforma';
  };
  const inTenant = typeof window !== 'undefined' && !!localStorage.getItem('platformToken');
  const is = (...roles) => !!user?.roles.some((r) => roles.includes(r));

  return <AuthCtx.Provider value={{ user, loading, login, logout, is, socket, enterTenant, backToPlatform, inTenant }}>{children}</AuthCtx.Provider>;
}
