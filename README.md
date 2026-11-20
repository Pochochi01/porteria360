# AdminCountrys — PWA multi-tenant para barrios cerrados

```
backend/   Node 22 + Express + MySQL + Socket.IO + Web Push
frontend/  React 18 + Vite + TailwindCSS + Axios + PWA (service worker propio)
```

## Puesta en marcha

```bash
cd backend
cp .env.example .env          # completar DB, JWT_SECRET, VAPID, MercadoPago
npx web-push generate-vapid-keys   # pegar las claves en .env
npm install
npm run db:init               # crea el esquema + tenant "demo" (admin@demo.com / admin123)
npm run dev                   # API en :4000

cd ../frontend
npm install
npm run dev                   # http://localhost:5173 (proxy /api y /socket.io → :4000)
```

Desde la raíz también se puede levantar todo junto: `npm install && npm run install:all && npm run dev`.

Administrador de plataforma: `npm run create:superadmin -- <email> <clave>` (en `backend/`). Para ingresar, dejar vacío el campo "Complejo".

## Producción
Guía completa para **Hostinger VPS (porteria360.net)**: DNS, SSL, Nginx, PM2 y MercadoPago en [docs/deploy-hostinger.md](docs/deploy-hostinger.md). Archivos: `backend/.env.production.example`, `deploy/nginx/porteria360.net.conf`, `deploy/ecosystem.config.cjs`.

```bash
npm run build      # compila la PWA en frontend/dist
npm start          # NODE_ENV=production: Express sirve el API y la PWA en el mismo puerto
```
- Poné un proxy inverso con HTTPS delante (Nginx/Caddy). La PWA, la cámara y las notificaciones push necesitan HTTPS. Reenviá también los WebSocket de `/socket.io`.
- En desarrollo, Socket.IO se conecta directo al backend (`:4000`), no por el proxy de Vite. Si el backend usa otro puerto, definí `VITE_API_PORT` en `frontend/.env`.
- `CORS_ORIGIN` acepta varios orígenes separados por coma. En desarrollo también se aceptan localhost y la red local.
- En `.env` de producción: `CORS_ORIGIN`, `PUBLIC_APP_URL` y `PUBLIC_API_URL` con tu dominio, un `JWT_SECRET` nuevo y un usuario de MySQL propio (no `root`).
- Si al arrancar falta una variable o no se puede usar la base, el backend lo dice y se detiene.

## Multi-tenant y seguridad
- El JWT lleva `sub`, `tenant_id`, `roles` y `lot_id`. El middleware `authenticate` fija `req.tenantId` y **todas** las consultas filtran por ese valor; el tenant nunca se toma del body ni de la query.
- Roles: `admin`, `supervisor`, `guard`, `owner`, `family`, `resident`. Se controlan con `requireRole(...)`.
- Socket.IO se autentica con el mismo JWT y usa salas por tenant, rol y usuario.
- Helmet, rate-limit en el login, validación con zod, bcrypt y `audit_log` para todas las acciones sensibles.

## Módulos y endpoints (`/api`)
| Módulo | Endpoints principales |
|---|---|
| Auth | `POST /auth/login`, `GET /auth/me`, `POST /auth/push-subscription` |
| Usuarios / lotes | `GET/POST /lots`, `GET/POST/PATCH /users` (admin), `GET/POST/PATCH /household` (propietario), `PATCH /profile` |
| Accesos | Propietario: `POST /visits/qr` (nombre, DNI, fecha y observaciones; el QR lleva solo un token aleatorio), `POST /visits/:id/cancel`, `POST /visits/:id/decision`. Guardia: `GET /visits/invitation/:token` (valida), `POST /visits/:id/entry` (ingreso atómico, una sola vez), `POST /visits/walk-in` (ingreso con DNI), `POST /visits/request` (pide autorización), `POST /visits/reject`, `/exit`, `GET /visits?movement=all|inside|exited|rejected&limit=5`, `GET /visits?view=active`, `GET /lots/search?q=&page=`, `GET /visits/:id/trace` |
| Rondas | `GET/POST /checkpoints` (con ubicación y radio), `POST /rounds/start`, `POST /rounds/:id/scan` (NFC/QR + GPS obligatorio, validado en el servidor), `/finish`, `GET /rounds` (tablero), `GET /rounds/:id/scans` (recorrido con mapa), `GET /round-scans` (informe de intentos). Un job marca cada minuto las rondas vencidas y dispara alertas. Ver [docs/rondas-geolocalizacion.md](docs/rondas-geolocalizacion.md) |
| Expensas | `POST /expenses/import` (Excel: lote, periodo, importe, vencimiento, detalle), `GET /expenses`, `POST /expenses/:id/transfer` (con comprobante), `/cash`, `POST /expenses/payments/:id/review`. Se rechaza todo importe distinto al total liquidado |
| Reservas | `GET/POST /spaces`, `GET /spaces/:id/availability?date=`, `GET/POST /reservations`, `/review`, `/cancel`. Reglas: cupo, horario, anticipación mínima y máxima, tope semanal por lote (con lock `FOR UPDATE`) |
| MercadoPago | `GET /pagos/oauth/url`, `GET /pagos/oauth/callback`, `POST /pagos/reservations/:id/preference` → `init_point`, `POST /pagos/webhook?tenant=ID` (valida `x-signature`, consulta el pago con el token del tenant y verifica `external_reference` y el importe) |
| Emergencias | `POST /incidents` (médica/seguridad + GPS, antirrebote de 30 s), `/ack`, `/resolve`, `GET /incidents/:id/audit`. Socket + push de prioridad alta a guardias y supervisores |

## Edición y eliminación definitiva (CRUD)
Cada módulo define su modelo en `backend/src/models/` (tabla, campos editables, roles, dependencias y cascada). El controlador genérico `backend/src/lib/crud.js` arma a partir de esa definición `PUT /api/<modulo>/:id` y `DELETE /api/<modulo>/:id`.

- **Documentación:** Swagger UI en `/api/docs`, especificación en `/api/docs.json` (copia en `docs/openapi.json`, importable en Postman).
- **DELETE es hard delete.** Si el registro tiene datos relacionados responde `409` con `dependencies`. Reenviando con `?force=1` borra también esos datos, en una transacción. Las dependencias marcadas `block` (por ejemplo, un lote con usuarios asignados) impiden el borrado hasta reasignarlas.
- **Permisos:** solo `admin` elimina dentro de un complejo y solo `superadmin` elimina complejos. Quién edita depende del módulo (por ejemplo, un guardia registra ingresos, egresos y rechazos pero no edita visitas; un supervisor edita visitas, rondas y puntos de control).
- **Auditoría:** cada edición guarda en `audit_log` los cambios (antes y después) y cada eliminación guarda el registro borrado y lo que se borró en cascada.
- **Pruebas:** `npm test` en `backend/`. Crea un complejo y usuarios de prueba, prueba edición, eliminación, cascadas, permisos por rol y aislamiento entre complejos, y al final borra todo.

## Landing, temas y branding por complejo
- **Rutas públicas:** `/` (landing), `/c/<slug>` (página pública de cada complejo) y `/login`. El panel quedó detrás del login, en las mismas rutas de antes.
- **Imágenes:** `npm run assets` (en `frontend/`) genera, a partir de `frontend/Imagenes/`, variantes día, noche, atardecer, premium y futurista en WebP y en varios anchos, en `public/generated-assets/{home,countries,buildings,neighborhoods}`. También genera el manifiesto `src/landing/data/assets.json`. Las variantes son gradaciones de color de las fotos originales, no imágenes nuevas.
- **Textos de la landing:** están en `src/landing/data/content.js`. ⚠️ Los testimonios y las cifras son **de ejemplo**; reemplazalos por datos reales antes de publicar.
- **Tema claro/oscuro:** `src/theme/ThemeProvider.jsx`. Se guarda en `localStorage` y, si no hay preferencia, sigue la del sistema operativo. Lo usan la landing y todo el panel.
- **Branding:** desde **Identidad y galería** (rol admin) se eligen tema, colores, tipografías, logo, portada, video y galería. Usa las tablas `tenant_themes`, `tenant_settings`, `tenant_assets` y `tenant_gallery`, y los archivos se guardan en `backend/uploads/tenants/<id>/`. La paleta `brand-*` de Tailwind toma el color de cada complejo, y el texto de los botones se ajusta solo para cumplir contraste AA.
- **Build:** `npm run build` compila la app y prerenderiza la portada (`scripts/prerender.mjs`). En producción, Express entrega `index.html` en `/` y `app.html` en el resto de las rutas.
- **Pedidos de demo:** se guardan en `demo_requests`. El superadmin los consulta en `GET /api/platform/demo-requests`.

## Lector de DNI en /guardia
- El botón **Escanear DNI** abre la cámara: la trasera en celulares, y en PC se puede elegir entre varias. Con ZXing lee el **PDF417** del DNI (formatos nuevo y anterior) y también los **QR de invitación**, que siguen el flujo de validación de siempre.
- Si en 15 s no logra leer el PDF417, o si el contenido no tiene formato de DNI, pasa solo a **OCR**: "Capturar imagen" envía la foto a `POST /api/dni/ocr`. Ahí se procesa con sharp (rotación, grises, normalización, contraste y nitidez) y con Tesseract. Lee el frente (rótulos Apellido/Nombre) o el dorso (MRZ).
- Antes de completar el formulario muestra una pantalla de confirmación donde los datos se pueden corregir. Como el formulario tiene un solo campo de nombre, se carga "APELLIDO NOMBRE".
- **Seguridad:** solo guardia, supervisor y admin pueden usarlo. Acepta JPG, PNG o WebP, verifica el contenido real del archivo y el máximo es 8 MB. Las imágenes se procesan en memoria y nunca se escriben en disco.
- **Logs:** `[dni] …` registra el método, el resultado, los campos encontrados y el tiempo, sin nombres ni números de documento.
- La primera vez que se usa el OCR, Tesseract descarga el modelo de español (~15 MB) a `backend/.tesseract-cache/`.
- La cámara solo funciona en **HTTPS** o en `localhost`: en el celular, probalo desde la app publicada con HTTPS.
- **Pruebas:** `npm test` en `frontend/` (parser y decodificación PDF417) y en `backend/` (parser OCR, OCR real con Tesseract y seguridad del endpoint).

## Módulo de expensas, gastos y portal del propietario
Gastos del country con comprobantes privados, rubros, proveedores, liquidación automática (porcentaje, coeficiente, m², valor fijo o mixto), transparencia para propietarios con gráfico por rubro, medios de pago, Mercado Pago por OAuth con acreditación automática, y reportes Excel/PDF. Después de actualizar: `npm run db:migrate` en `backend/`. Arquitectura, endpoints y pruebas: [docs/expensas-plan.md](docs/expensas-plan.md).

## Calidad de código (ESLint)
`npm run lint` y `npm run lint:fix` desde la raíz. Una sola configuración para frontend y backend en `eslint.config.mjs`. Reglas, convenciones y cómo agregar reglas nuevas: [docs/eslint.md](docs/eslint.md).

## Convención de fechas
Los `DATETIME` se guardan en hora local del complejo (`TZ` en `.env`).
