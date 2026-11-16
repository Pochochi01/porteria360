import { createContext, useContext, useEffect } from 'react';

/** Contexto de sesión. El proveedor está en ./AuthProvider.jsx */
export const AuthCtx = createContext(null);

export const useAuth = () => useContext(AuthCtx);

/** Suscribe a un evento de socket mientras el componente esté montado. */
export function useSocketEvent(event, handler) {
  const { socket } = useAuth();
  useEffect(() => {
    if (!socket) { return; }
    socket.on(event, handler);
    return () => socket.off(event, handler);
  }, [socket, event, handler]);
}
