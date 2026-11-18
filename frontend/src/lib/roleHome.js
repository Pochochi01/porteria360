// Pantalla inicial según el perfil. Para un perfil nuevo, agregar una fila: no hay que tocar el router.
// Se evalúa en orden: un usuario con varios roles entra por el de mayor responsabilidad.
// Si la ruta configurada no está habilitada para el usuario, se usa la primera del menú.
export const ROLE_HOME = [
  { role: 'superadmin', to: '/plataforma' },
  { role: 'admin', to: '/admin' },
  { role: 'supervisor', to: '/rondas' },
  { role: 'guard', to: '/guardia' }, // Seguridad → Accesos
  { role: 'owner', to: '/expensas' }, // Propietario → Expensas
  { role: 'family', to: '/expensas' },
  { role: 'resident', to: '/visitas' },
];

/**
 * @param {string[]} roles roles del usuario
 * @param {string[]} allowed rutas que el usuario puede ver (menú ya filtrado)
 */
export function homeFor(roles, allowed) {
  const hit = ROLE_HOME.find((h) => roles.includes(h.role) && allowed.includes(h.to));
  return hit?.to || allowed[0] || '/';
}
