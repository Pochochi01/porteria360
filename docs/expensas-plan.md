# Módulo de Expensas, Gastos, Rendición de cuentas y Portal del propietario

Análisis previo (fases 1 a 5), aprobado con 4 decisiones, e implementación (fases 6 a 9).

---

## Fase 1 · Auditoría del sistema actual

### Backend (Node 22 · Express 4 · MySQL · ES modules)

| Área | Qué existe | Dónde |
|---|---|---|
| Multi-tenant | `tenants` + `req.tenantId` tomado del JWT; todas las consultas filtran por complejo | `middleware/auth.js` |
| Usuarios y roles | `users` (con `lot_id` y `parent_user_id`), `roles` (`superadmin`, `admin`, `supervisor`, `guard`, `owner`, `family`, `resident`), `user_roles`; `requireRole(...)` | `routes/users.js`, `models/users.js` |
| Lotes | `lots` (`code`, `address`). **Cada usuario tiene un solo lote** (`users.lot_id`) | `models/lots.js` |
| Liquidaciones (expensas) | `expense_settlements` (lote, período, importe, vencimiento, estado `pending/in_review/paid`, detalle); importación desde Excel; regla **sin pagos parciales** | `routes/expenses.js`, `models/expenses.js` |
| Pagos de expensas | `expense_payments` (transferencia con comprobante / efectivo, aprobación, n° de recibo); recalcula el estado de la liquidación al borrar | `routes/expenses.js` |
| MercadoPago | OAuth por complejo (`tenants.mp_access_token`), preferencia y webhook con firma, **hoy solo para reservas** | `routes/payments.js` |
| Archivos públicos | `tenant_assets` (logo, portada, video, galería) servidos sin login en `/uploads/tenants`; conversión a WebP; límites por tipo | `routes/branding.js` |
| Archivos privados | Comprobantes de pago en `uploads/receipts`, descarga solo con permiso (`/expenses/payments/:id/receipt-file`). **No usan `tenant_assets`** | `routes/expenses.js` |
| Configuración del complejo | `tenant_settings` (nombre visible, logo, colores, tipografías, portada, video) | `routes/branding.js` |
| CRUD genérico | `defineModel` + `mountModel`: PUT/DELETE con validación, dependencias, cascada, auditoría y OpenAPI automático | `lib/crud.js`, `routes/crud.js`, `routes/docs.js` |
| Auditoría | `audit_log` + `audit(req, entidad, id, acción, datos)` | `lib/helpers.js` |
| Notificaciones | Socket.IO por complejo/rol/usuario + Web Push | `lib/realtime.js` |
| Exportación | Solo **importación** Excel (`xlsx`). No hay exportador PDF ni Excel | — |
| Pruebas | `node --test`: 26 pruebas de integración en backend (complejo efímero) y 8 en frontend | `backend/test`, `frontend/test` |

### Frontend (React 18 · Vite 5 · Tailwind · PWA)

| Área | Qué existe |
|---|---|
| Layout | `AppShell` en `App.jsx`: menú lateral **plano** filtrado por rol, branding del complejo y tema claro/oscuro |
| Rutas | Un `MENU` con `{ to, label, roles, el }` y carga diferida por pantalla |
| Autenticación | `lib/auth.js` (`useAuth`, `useSocketEvent`) + `AuthProvider.jsx`; un solo login para todos los roles |
| Componentes | `ui.jsx` (`Field`, `PageTitle`, `Alert`, `Status`), `crud.jsx` (`Modal`, `EditModal`, `ConfirmDelete`), `Gallery`/`Lightbox`, `icons.jsx`, `TiltCard` |
| Hooks | `useFetch`, `useForm`, `useCrud` (botones Editar/Eliminar + modales), `useReveal`, `useCountUp`, `useMediaQuery` |
| Utilidades | `lib/format.js` (`fmtDate`, `money`, `opts`), `lib/api.js` (axios + `errMsg`) |
| Gráficos | **Sin librería**: SVG propios en `landing/components/Charts.jsx` (`AreaChart`, `Bars`, `Ring`) |
| Tablas | No hay `DataTable`: 8 pantallas usan la clase `.table` directamente |
| Subida de archivos | `UploadSlot` dentro de `pages/Branding.jsx` (no es compartido) |
| Expensas hoy | `pages/Expenses.jsx`: el admin importa, registra efectivo y revisa transferencias; el propietario ve su saldo y paga por transferencia |

---

## Fase 2 · Mapa de reutilización

| Necesidad del módulo | Se reutiliza | Cómo |
|---|---|---|
| Edición/eliminación de rubros, proveedores, gastos y medios de pago | `defineModel` + `useCrud` | Un modelo por entidad; PUT/DELETE, auditoría y OpenAPI salen solos |
| Liquidaciones | `expense_settlements` | El motor de generación **escribe en la misma tabla**; la importación Excel sigue funcionando |
| Pagos | `expense_payments` + revisión del admin + recibos | Se agrega el método `mercadopago` (y los informados por transferencia/QR); misma regla sin parciales |
| Pago online | OAuth y webhook de `payments.js` | Misma preferencia y webhook; `external_reference` distingue `reserva` / `expensa` |
| Comprobantes de gastos | `tenant_assets` | Mismo registro de archivos, con una marca de **privado** y descarga autenticada (no público) |
| Configuración del complejo | `tenant_settings` | Se agregan CUIT, razón social, domicilio, email y teléfono; el logo ya existe |
| Auditoría | `audit()` | Acciones nuevas: `expense_run`, `payment_method_update`, etc. |
| Permisos | `requireRole` + filtro por `req.user.lot_id` | Sin sistema nuevo; el propietario ve solo su lote |
| Gráfico de torta | `Charts.jsx` | Se agregó `Pie` en SVG (sin librería nueva) y el archivo pasó a `components/` para compartirlo |
| Visor de comprobantes | `Modal` + `Lightbox` | Imagen en `Lightbox`; PDF en `Modal` con `<iframe>` |
| Subida de archivos | `storeAsset`/`removeAsset` de Branding | Se movieron a `lib/files.js` y Branding los importa; en el frontend bastó un `<input type=file>` (no hizo falta mover `UploadSlot`) |
| Formato | `money`, `fmtDate`, `Status` | Sin cambios |
| Exportación Excel | `xlsx` (ya instalado en backend) | Se escribe el exportador una vez y lo usan todos los reportes |
| Notificaciones | Socket.IO + Web Push | Aviso al propietario cuando se emite una expensa o se aprueba un pago |

---

## Fase 3 · Entidades a modificar (sin romper lo existente)

| Tabla | Cambio | Compatibilidad |
|---|---|---|
| `tenant_settings` | `+ cuit, legal_name, address, email, phone` | Columnas opcionales |
| `lots` | `+ surface_m2, coefficient, share_pct` (para los métodos de prorrateo) | Opcionales; el método valida que estén cargadas |
| `expense_settlements` | `+ run_id` (FK a la generación) y `+ breakdown JSON` (cómo se calculó) | Opcionales; las importadas desde Excel quedan con `run_id NULL` |
| `expense_payments` | `method` suma `mercadopago`; `+ asset_id` opcional; `+ mp_payment_id` | `receipt_path` sigue funcionando para los comprobantes actuales |
| `tenant_assets` | `kind` suma `document`; `+ private TINYINT` (privados guardados fuera de `/uploads/tenants`) | Los existentes quedan públicos como hoy |

## Fase 4 · Entidades nuevas estrictamente necesarias

| Tabla | Por qué no existe hoy | Campos clave |
|---|---|---|
| `expense_categories` (rubros) | No hay catálogo | `tenant_id, name` **único por complejo**, `active`, `sort_order`. Se precargan los 12 rubros sugeridos |
| `suppliers` (proveedores) | No existe módulo de proveedores | `tenant_id, legal_name, trade_name, cuit` (único por complejo), `email, phone, address, active` |
| `expenditures` (gastos) | Solo existe la liquidación al propietario, no el gasto del country | `tenant_id, date, period, category_id, supplier_id, concept, amount, voucher_type, voucher_number, notes, asset_id → tenant_assets` |
| `expense_runs` (generaciones) | La liquidación hoy se importa ya calculada | `tenant_id, period, method, params JSON, total, due_date, status (borrador/emitida), created_by` |
| `payment_methods` (medios de pago) | No existe | `tenant_id, type (transfer/mercadopago/modo/naranjax), label, data JSON` (alias, CBU, banco, titular, QR, URL), `active, sort_order` |

Se llaman `expenditures` (y no `expenses`) porque `/api/expenses` ya son las liquidaciones: un nombre distinto evita confusiones.

**Motor de generación (preparado para crecer):** una función por método, con la firma `(lotes, total, params) → [{ lote, importe, detalle }]`.

| Método | Cálculo |
|---|---|
| `percentage` | `share_pct` de cada lote |
| `coefficient` | Proporcional al coeficiente |
| `surface` | Proporcional a los m² |
| `fixed` | Valor fijo por lote |
| `mixed` | Combina métodos por porcentaje; queda preparado y se activa más adelante |

El redondeo al centavo se ajusta en el último lote, para que la suma sea exactamente el total. Antes de emitir hay una vista previa en borrador.

## Fase 5 · Plan de migración

1. **Cambios aditivos:** `ALTER TABLE ... ADD COLUMN` con `IF NOT EXISTS` y `CREATE TABLE IF NOT EXISTS` en un script idempotente (`npm run db:migrate`), que se puede ejecutar varias veces sin efecto.
2. **Datos actuales:** las liquidaciones y pagos existentes no se tocan; los 12 rubros sugeridos se cargan en cada complejo.
3. **Orden:** primero las tablas, después el backend (los endpoints nuevos conviven con los actuales), y al final el frontend.
4. **Pruebas:** se suman a `npm test` en un complejo efímero, como las existentes.
5. **Vuelta atrás:** las columnas y tablas nuevas no son usadas por el código anterior, así que la versión previa sigue funcionando con la base migrada.

## Decisiones aprobadas

| Tema | Decisión |
|---|---|
| PDF | `pdfkit` en el servidor (única dependencia nueva del módulo) |
| Lotes | **Varios por propietario**: tabla `user_lots`. `users.lot_id` sigue siendo el lote principal (accesos, visitas y reservas no cambian) |
| Portal | Lo ven propietario y familiares (los lotes del propietario); **solo el propietario paga**. Inquilinos/residentes no ven datos económicos |
| Mercado Pago | Acreditación **automática** por webhook, idempotente |

## Fase 6 · Backend implementado

| Archivo | Qué hace |
|---|---|
| `lib/migrate.js` | Migración aditiva e idempotente (`npm run db:migrate`; también corre en `db:init`). Rubros sugeridos y `user_lots` desde `users.lot_id` |
| `lib/files.js` | Archivos de `tenant_assets`: públicos (branding) y **privados** (`kind='document'`, en `uploads/private`, nunca estáticos). Verifica firma de PDF y convierte imágenes |
| `lib/expenseEngine.js` | Motor de prorrateo: `percentage`, `coefficient`, `surface`, `fixed`, `mixed` (+ `equal` dentro del mixto). Reparto al centavo por mayor resto |
| `lib/ownership.js` | Único lugar que decide qué lotes ve cada usuario |
| `lib/exporter.js` | Excel (`xlsx`) y PDF (`pdfkit`) con encabezado del complejo (logo, razón social, CUIT) |
| `models/finance.js` | PUT/DELETE de rubros, proveedores, gastos y medios de pago vía `lib/crud.js` (validación, dependencias, auditoría, OpenAPI) |
| `routes/finance.js` | Altas, listados paginados, comprobantes, transparencia, configuración, generación, dashboard y reportes |
| `routes/ownerPortal.js` | `/owner/summary`, `/owner/settlements`, `/owner/payments` |
| `routes/payments.js` | OAuth (`/oauth/url?return=`, `/oauth/status`, `DELETE /oauth`), preferencia de expensa y webhook con rama de expensas |
| `routes/expenses.js`, `routes/users.js` | Filtrado por lotes del usuario; `GET/PUT /users/:id/lots` |

### Endpoints nuevos

| Método | Ruta | Roles |
|---|---|---|
| GET/POST | `/api/expense-categories` · PUT/DELETE `/:id` | admin |
| GET/POST | `/api/suppliers` · PUT/DELETE `/:id` | admin |
| GET/POST | `/api/expenditures` (multipart con `voucher`) · PUT/DELETE `/:id` | admin |
| POST | `/api/expenditures/:id/voucher` | admin |
| GET | `/api/expenditures/:id/voucher` | admin, owner, family |
| GET | `/api/expenditures/summary?period=` · `/api/expenditures/periods` | admin, owner, family |
| GET/PUT | `/api/expense-config` | admin |
| GET | `/api/payment-methods` (activos para propietarios) | admin, owner, family |
| POST · PUT/DELETE `/:id` | `/api/payment-methods` | admin |
| GET | `/api/expense-runs/methods` · `/api/expense-runs` | admin |
| POST | `/api/expense-runs/preview` · `/api/expense-runs` | admin |
| GET | `/api/expense-dashboard?period=` | admin |
| GET | `/api/expense-reports/expenditures?period=&format=xlsx\|pdf` | admin, owner, family |
| GET | `/api/expense-reports/collections?period=&format=xlsx\|pdf` | admin |
| GET | `/api/owner/summary` · `/api/owner/settlements` · `/api/owner/payments` | owner, family |
| GET/PUT | `/api/users/:id/lots` | admin |
| GET | `/api/pagos/oauth/status` · DELETE `/api/pagos/oauth` | admin |
| POST | `/api/pagos/expenses/:id/preference` | owner |

Auditoría (`audit_log`): alta/modificación/eliminación de gastos, rubros y proveedores (`create`/`update`/`delete`), `expense_run.generate`, `payment_method.create/update/delete`, `tenant_settings.update`, `user.lots_update`, pagos (`transfer_reported`, `cash_registered`, `approved/rejected`, `mp_payment_registered`), `mp_oauth_linked/unlinked`.

## Fase 7 · Frontend implementado

Mismo ítem de menú **Expensas** (ahora también para familiares) con pestañas según el rol:

- **Administración:**
  - Resumen (8 indicadores + reportes de cobranza);
  - Gastos (alta con comprobante, filtros por período y paginado);
  - Gastos del período;
  - Liquidar (bases de prorrateo, vista previa y emisión);
  - Liquidaciones (la pantalla anterior, sin cambios de comportamiento);
  - Rubros, Proveedores y Medios de pago;
  - Configuración (datos del complejo + **conexión con Mercado Pago por OAuth**).
- **Propietario / familiar:**
  - Mi cuenta (expensa actual, deuda acumulada, total a pagar, próximo vencimiento, estado, pago por transferencia o Mercado Pago, medios de pago);
  - Gastos del período (torta + rubros desplegables con proveedor, factura, fecha y "Ver comprobante");
  - Historial (expensas y pagos, paginados).
- **Usuarios:** botón **Lotes** para asignar varios lotes a un propietario.

Componentes nuevos y reutilizables:
- `components/Tabs.jsx`, `MetricCard.jsx`, `DocumentViewer.jsx` (sobre `Modal`) y `Charts.jsx` (+ `Pie`);
- `lib/download.js`, `lib/chartColors.js`;
- `fmtDay`, `fmtPct` y `currentPeriod` en `lib/format.js`.

`Modal` ganó `role="dialog"` y la opción `wide`.

## Fase 8 · Testing

- `backend/test/expenseEngine.test.js`: 9 pruebas del motor (los 5 métodos, redondeo exacto con 137 lotes, errores).
- `backend/test/crud.test.js`: 14 pruebas de integración del módulo:
  - rubros sin duplicados;
  - CUIT válido y único;
  - comprobantes privados (no servidos estáticos, permisos por rol);
  - transparencia sin datos internos;
  - borrado del archivo junto con el gasto;
  - varios lotes y familiares;
  - generación, conflicto y reemplazo de pendientes;
  - aislamiento entre propietarios;
  - dashboard, reportes Excel/PDF y medios de pago;
  - **Mercado Pago con API simulada**: preferencia por el total, importe distinto ignorado, webhook repetido sin duplicar el pago.
- Navegador (Chrome, complejo temporal): 13 verificaciones de las pantallas de administración y del propietario, incluido móvil.

## Fase 9 · Operación

1. `npm run db:migrate` en `backend/` (seguro de repetir).
2. Para cobrar online: en `.env`, `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `PUBLIC_API_URL` (https) y `PUBLIC_APP_URL`; luego **Expensas → Configuración → Conectar con Mercado Pago**.
3. Cargar m², coeficiente o porcentaje de cada lote en **Liquidar → Bases de prorrateo** antes de usar esos métodos.
