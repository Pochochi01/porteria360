// Aplica el tema guardado antes de pintar (evita el destello claro→oscuro en la portada prerenderizada).
// Archivo externo y mínimo para no tener que habilitar scripts inline en la CSP.
(function () {
  try {
    var p = localStorage.getItem('theme');
    var dark = p === 'dark' || (p !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) { /* sin localStorage: tema del sistema vía CSS */ }
})();
