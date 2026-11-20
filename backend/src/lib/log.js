// Logs estructurados (una línea JSON por evento): PM2 los guarda tal cual y se pueden filtrar con jq/grep.
const quiet = process.env.NODE_ENV === 'test';
const write = (level, event, data) => {
  if (quiet && level !== 'error') { return; }
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...data });
  (level === 'error' ? console.error : console.log)(line);
};

export const log = {
  info: (event, data = {}) => write('info', event, data),
  warn: (event, data = {}) => write('warn', event, data),
  error: (event, data = {}) => write('error', event, data),
};
