import axios from 'axios';

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token');
  if (token) { cfg.headers.Authorization = `Bearer ${token}`; }
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && !err.config.url.includes('/auth/login')) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const errMsg = (e) => {
  if (e.response?.data?.error) { return e.response.data.error; }
  // Sin respuesta, o 5xx sin cuerpo (proxy de Vite sin backend): el API no está accesible
  if (!e.response || (e.response.status >= 500 && !e.response.data?.error)) { return 'No se pudo conectar con el servidor. Verificá que el backend esté en ejecución.'; }
  return e.message || 'Error inesperado';
};
