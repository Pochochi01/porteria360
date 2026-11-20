# Rondas: validación geográfica de puntos de control

Evita que un guardia marque un punto escaneando una foto del QR desde otro lugar: cada marca exige una
ubicación GPS fresca, precisa y dentro del radio del punto. **El backend decide**; el frontend solo informa
lo que midió el dispositivo (o por qué no pudo medir) y muestra el resultado.

## Flujo

1. El guardia escanea el QR (o lee el NFC) del punto.
2. `acquireFix()` (frontend/src/lib/geo.js) pide permiso si hace falta y escucha el GPS (`enableHighAccuracy`,
   `maximumAge: 0`, nunca posiciones cacheadas) hasta llegar a la precisión pedida o a 20 s.
3. Se envía `POST /api/rounds/:id/scan` con `{ tag_code, method, position: { lat, lng, accuracy, timestamp } }`
   o, si no hubo ubicación, `{ tag_code, method, geo_error }`.
4. `evaluateScan()` (backend/src/lib/geo.js) decide el estado:

   | Orden | Condición | Estado (`round_scans.status`) | Especificación |
   |---|---|---|---|
   | 1 | no hay posición: permiso denegado | `gps_denied` | GPS_DENEGADO |
   | 1 | no hay posición: GPS apagado / navegador sin soporte / sin HTTPS | `gps_disabled` | GPS_DESACTIVADO |
   | 1 | no hay posición: timeout u otro error | `location_error` | ERROR_UBICACION |
   | 2 | lectura con más de `GPS_MAX_FIX_AGE_S` de antigüedad | `location_error` | ERROR_UBICACION |
   | 3 | el punto no tiene coordenadas cargadas | `point_unlocated` | (adicional) |
   | 4 | `accuracy > GPS_MAX_ACCURACY_M` | `gps_inaccurate` | GPS_IMPRECISO |
   | 5 | distancia Haversine `> radius_m` del punto | `out_of_range` | FUERA_DE_RADIO |
   | 6 | todo lo anterior OK | `valid` | VALIDO |

   La precisión se evalúa antes que la distancia: con ±200 m la distancia calculada no es confiable.
5. Todo intento se guarda en `round_scans`. Solo `valid` marca `round_points` (UPDATE condicional
   `scanned_at IS NULL`: dos escaneos simultáneos no duplican la marca). Los no válidos responden **422**
   con `{ error, status, distance_m, accuracy_m, radius_m }`.
6. `gps_denied`, `out_of_range` y `gps_inaccurate` se registran además en `audit_log` (entidad `round_scan`),
   se emiten al tablero en vivo (`round:scan`) y se escriben como log JSON (`event: "round.scan"`).

## Modelo de datos (migración idempotente `npm run db:migrate`)

- `checkpoints`: `lat DECIMAL(10,7)`, `lng DECIMAL(10,7)`, `radius_m INT DEFAULT 30`.
- `round_points` (marca válida): `accuracy_m`, `distance_m`, `scan_id`.
- `round_scans` (nueva): usuario, ronda, punto, fecha y hora, método, estado, lat/lng reportadas, precisión,
  distancia, **copia de la ubicación y radio del punto en ese momento** (si luego se mueve el punto, el
  historial sigue mostrando contra qué se validó), `geo_error`, dispositivo, navegador e IP.
  Índices: `(round_id, scanned_at)`, `(tenant_id, status, scanned_at)`, `(checkpoint_id, scanned_at)`.

## Endpoints

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| POST | `/checkpoints` | supervisor, admin | Alta con `lat`, `lng` (juntas o ninguna) y `radius_m` (5–1000) |
| PUT | `/checkpoints/:id` | supervisor, admin | Edición parcial auditada; rechaza dejar una sola coordenada |
| POST | `/rounds/:id/scan` | guard | Escaneo con validación geográfica |
| GET | `/rounds/:id/scans` | supervisor, admin | Ronda + puntos + todos los intentos (para el mapa) |
| GET | `/round-scans?status=invalid\|all\|<estado>&days=1..90` | supervisor, admin | Informe de intentos |

## Configuración (`backend/.env`)

| Variable | Default | Uso |
|---|---|---|
| `GPS_MAX_ACCURACY_M` | 50 | Precisión máxima aceptada. El frontend la recibe en `round.geo.max_accuracy_m` |
| `CHECKPOINT_DEFAULT_RADIUS_M` | 30 | Radio de un punto nuevo si no se indica |
| `GPS_MAX_FIX_AGE_S` | 120 | Antigüedad máxima de la lectura |

## Navegadores y PWA

- La geolocalización (y la cámara) **solo funcionan con HTTPS** (o `localhost`). Sin contexto seguro el
  guardia ve el aviso y los botones de escaneo quedan deshabilitados.
- **iOS (Safari / PWA instalada):** el permiso se pide con un toque (al "Iniciar ronda" o "Activar
  ubicación"). Si se negó, se habilita en Ajustes → Privacidad → Localización → Safari/Sitios web.
  iOS no siempre informa el estado del permiso (`navigator.permissions`); el flujo no depende de eso.
- **Android (Chrome, Edge, Samsung Internet):** si el GPS del sistema está apagado, el navegador devuelve
  `POSITION_UNAVAILABLE` → `gps_disabled`.
- **Escritorio (Chrome/Edge):** la ubicación suele venir por Wi-Fi con ±50–1000 m; normalmente quedará como
  `gps_inaccurate`, lo cual es correcto: las rondas se hacen con el celular.

## Mapa

Leaflet + teselas de OpenStreetMap (`https://tile.openstreetmap.org`, agregado a `img-src` de la CSP).
Leaflet se carga en un chunk aparte solo cuando se abre un mapa. Para mucho tráfico conviene un proveedor
de teselas propio o comercial (la política de uso de OSM limita el uso intensivo).

## Límites conocidos

La ubicación la informa el dispositivo: un teléfono rooteado o con "ubicación simulada" puede mentir.
Mitigaciones posibles: NFC con tags que no se puedan fotografiar, QR rotativos, detección de saltos
imposibles entre puntos (velocidad), o atestación del dispositivo (Play Integrity / App Attest) con una app nativa.
