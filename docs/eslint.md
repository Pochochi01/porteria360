# ESLint en AdminCountrys

Una sola configuración ([`eslint.config.mjs`](../eslint.config.mjs), formato *flat config* de ESLint 9) en la raíz del proyecto. Cubre el frontend (React + Vite) y el backend (Node + Express), cada uno con su entorno.

## Uso

Desde la raíz del proyecto:

```bash
npm run lint       # revisa todo el proyecto
npm run lint:fix   # corrige automáticamente lo que se pueda (formato, llaves, imports, etc.)
npx eslint frontend/src/pages/GuardAccess.jsx   # un archivo puntual
```

- **Editor:** con la extensión *ESLint* (VS Code) los problemas se ven mientras escribís. Para corregir al guardar, en `.vscode/settings.json`: `"editor.codeActionsOnSave": { "source.fixAll.eslint": "explicit" }`.
- **Antes de un commit o PR:** `npm run lint` tiene que terminar sin errores.
- **En producción:** `NODE_ENV=production npm run lint` convierte en **error** los `console.log` del frontend.

## Qué se analiza

| Zona | Entorno | Notas |
|---|---|---|
| `frontend/src/**` | navegador + React 18 | reglas de React, Hooks y Fast Refresh |
| `frontend/src/sw.js` | service worker | |
| `frontend/src/entry-prerender.jsx` | Node (prerender en el build) | |
| `backend/**`, `frontend/scripts/**`, `frontend/test/**`, `*.config.*` | Node | `console` permitido: es el logger del servidor y de los scripts |

Se ignoran: `node_modules`, `dist`, `dist-ssr`, `frontend/public`, `backend/uploads`, `backend/.tesseract-cache` y `.claude` (skills de terceros).

## Reglas más importantes

| Regla | Por qué |
|---|---|
| `no-unused-vars` | Variables, imports y parámetros sin uso son código muerto. Prefijo `_` para parámetros obligatorios que no se usan (p. ej. `_next` en el manejador de errores de Express, que necesita 4 parámetros). Al desestructurar para *quitar* campos (`const { password_hash, ...user } = u`) no se marca. |
| `no-undef`, `no-unreachable`, `no-duplicate-imports` | Errores de referencia, código inalcanzable e imports repetidos. |
| `eqeqeq` (`null: 'ignore'`) | Siempre `===`, salvo `x == null`, que cubre `null` y `undefined` a propósito. |
| `curly: all` | Llaves en todos los `if`/`for`/`while`. Evita errores al agregar una segunda línea. |
| `no-console` | Frontend: `warn` en desarrollo y `error` con `NODE_ENV=production`. Se permiten `console.warn`/`console.error`. |
| `react-hooks/rules-of-hooks` | Los hooks solo se llaman en componentes o en otros hooks (`useX`), nunca dentro de funciones comunes. |
| `react-hooks/exhaustive-deps` (error) | Dependencias completas en `useEffect`/`useCallback`/`useMemo`. |
| `react/jsx-key` | `key` estable en listas; `react/no-array-index-key` avisa si se usa el índice. |
| `react-refresh/only-export-components` | Un archivo `.jsx` exporta solo componentes. Hooks y utilidades van aparte (`hooks/`, `lib/`) para que Vite pueda recargar sin perder estado. |
| `no-promise-executor-return` | `new Promise((r) => { setTimeout(r, 100); })`, con llaves. |
| `prefer-const`, `no-var`, `object-shorthand`, `prefer-template`, `dot-notation`, `no-else-return` | Estilo moderno y consistente. |
| `@stylistic/brace-style`, `@stylistic/block-spacing`, `@stylistic/no-trailing-spaces` | Formato mínimo: `if (x) { return; }` y sin espacios al final de línea. |

Excepciones con justificación técnica (en la configuración, no ocultas):
- `react/prop-types: off`: las props se documentan con JSDoc; PropTypes duplicaría esa información en runtime.
- `react/no-unknown-property` ignora `fetchpriority`: React 18 solo acepta el atributo en minúsculas (`fetchPriority` existe recién en React 19).

## Buenas prácticas adoptadas

- **`eslint-disable` solo con justificación**, en la misma línea y con `--` explicando el motivo. Hoy hay **uno** en todo el proyecto (`Charts.jsx`: serie posicional fija donde el índice *es* la identidad). `reportUnusedDisableDirectives` marca los que ya no hacen falta.
- **Estructura:** componentes en `components/` y `pages/`; hooks en `hooks/` (`useFetch`, `useForm`, `useCrud`, `useReveal`…); utilidades sin JSX en `lib/` (`format`, `assets`, `geo`, `auth`, `dni`…); contexto y proveedor en archivos separados (`lib/auth.js` + `lib/AuthProvider.jsx`, `theme/theme.js` + `theme/ThemeProvider.jsx`).
- **Backend:** errores a través de `HttpError` y del manejador central; cada handler async envuelto en `ah()`; apagado ordenado con `SIGTERM`/`SIGINT`.

## Agregar una regla nueva

1. Agregala en el bloque que corresponda de `eslint.config.mjs` (base, frontend o Node).
2. Corré `npm run lint:fix` y después `npm run lint`.
3. Si quedan casos que no se pueden corregir, arreglalos en el código. Si la regla no aplica en un caso concreto, justificalo con `eslint-disable-next-line regla -- motivo`.
4. Verificá que el build y las pruebas sigan pasando: `npm run build` y `npm test` en `frontend/` y `backend/`.

## Recomendaciones a futuro

- **Prettier** para el formato completo (indentación, largo de línea). ESLint aplica solo las reglas mínimas de formato que necesita.
- **Husky + lint-staged** para ejecutar `eslint --fix` sobre los archivos modificados antes de cada commit, una vez que el proyecto esté en git.
- **CI** (GitHub Actions u otro): `npm ci && npm run lint && npm test` en cada PR.
- Evaluar **TypeScript** gradual (`checkJs` + JSDoc ya existente) y `typescript-eslint`.
- Subir a **ESLint 10** cuando `eslint-plugin-react` lo soporte oficialmente.
