# Despliegue en Hostinger VPS (KVM 2) · porteria360.net

Arquitectura: **un solo dominio**. Nginx recibe las peticiones (HTTP; HTTPS cuando se instale el certificado) y pasa todo a Node (Express) en `127.0.0.1:5007`. Express sirve **la API (`/api/...`) y la PWA** a la vez, y Socket.IO va por el mismo dominio (`/socket.io/`).

```
Usuario ──HTTP(S)──▶ Nginx :80/:443 (porteria360.net) ──▶ Node 127.0.0.1:5007 ──▶ MySQL (local)
                   www.porteria360.net ─301─▶ porteria360.net
```

## 1. DNS (panel de Hostinger → Dominios → DNS)

Los registros actuales **alcanzan**; no hace falta un registro aparte para el frontend.

| Tipo | Nombre | Contenido | Para qué |
|---|---|---|---|
| A | `@` | `31.97.85.19` | El dominio apunta al VPS (verificá que sea la IP que muestra **VPS → Resumen**) |
| CNAME | `www` | `porteria360.net` | `www` llega al mismo servidor; Nginx lo redirige al dominio principal |

- **Opcional — IPv6:** si el VPS tiene IPv6 (**VPS → Resumen**), podés agregar `AAAA @ <IPv6 del VPS>`. Si no, no lo agregues.
- **Email:** si más adelante querés correo `@porteria360.net`, se agregan registros MX/TXT del proveedor de correo. No afecta al sistema.
- **SSL:** la pestaña **SSL** del panel es para los planes de *hosting compartido*. En un VPS el certificado lo emitís vos con Let's Encrypt (paso 4) y es gratis.
- **Propagación:** el aviso "Tu dominio va a estar en línea pronto" es la propagación del DNS. Verificalo con `nslookup porteria360.net` o en https://dnschecker.org (debe responder `31.97.85.19`).

## 2. Preparar el VPS (Ubuntu 22.04 / 24.04)

```bash
ssh root@31.97.85.19
apt update && apt upgrade -y
# Node 22, Nginx, MySQL, Certbot, Git
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs nginx mysql-server certbot git
npm install -g pm2
# Firewall: solo SSH y web. El puerto 5007 NO se abre (Node escucha en 127.0.0.1)
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable
```

Revisá también el **firewall del panel de Hostinger** (VPS → Seguridad → Firewall): si está activo, permití los puertos 22, 80 y 443.

## 3. Base de datos

```bash
mysql_secure_installation
mysql -u root -p
```
```sql
CREATE DATABASE porteria360 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'porteria360'@'localhost' IDENTIFIED BY 'UNA-CLAVE-LARGA-Y-ALEATORIA';
GRANT ALL PRIVILEGES ON porteria360.* TO 'porteria360'@'localhost';
FLUSH PRIVILEGES;
```

## 4. Certificado SSL (opcional al principio, necesario para producción)

La configuración de Nginx viene **sin certificados** (solo puerto 80). Cuando el DNS ya resuelva al VPS, agregá HTTPS con un comando (Certbot edita el archivo de Nginx y renueva solo):

```bash
apt install -y python3-certbot-nginx
certbot --nginx -d porteria360.net -d www.porteria360.net -m admin@porteria360.net --agree-tos --redirect
```

Después cambiá en `backend/.env` `PUBLIC_API_URL` y `PUBLIC_APP_URL` a `https://porteria360.net` y reiniciá (`pm2 restart porteria360`).

> Sin HTTPS no funcionan: la cámara (escaneo de DNI/QR), la instalación como app (PWA), las notificaciones push ni los webhooks de MercadoPago.

## 5. Aplicación

```bash
mkdir -p /var/www && cd /var/www
git clone <tu-repositorio> porteria360 && cd porteria360
npm run install:all
cp backend/.env.production.example backend/.env
nano backend/.env            # completar DB_PASSWORD, JWT_SECRET, VAPID_*, MP_*
npm run build                # compila la PWA (frontend/dist)
cd backend && npm run db:init && npm run db:migrate
npm run create:superadmin -- tu-email@dominio.com 'UNA-CLAVE-SEGURA' "Tu Nombre"
cd .. && mkdir -p logs
pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup   # seguir el comando que imprime pm2 startup
```

## 6. Nginx

```bash
cp deploy/nginx/porteria360.net.conf /etc/nginx/sites-available/porteria360.net
ln -s /etc/nginx/sites-available/porteria360.net /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

Comprobación: `curl -I http://porteria360.net` → `200`; `curl http://porteria360.net/api/health` → `{"ok":true}`; `www.` redirige a `porteria360.net`.

## 7. MercadoPago

En https://www.mercadopago.com.ar/developers/panel → tu aplicación:

| Campo | Valor |
|---|---|
| URL de redireccionamiento (OAuth) | `https://porteria360.net/api/pagos/oauth/callback` |
| Webhooks · eventos "Pagos" | `https://porteria360.net/api/pagos/webhook` |

Copiá *Client ID*, *Client Secret* y la *clave secreta de Webhooks* al `.env` (`MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_WEBHOOK_SECRET`) y reiniciá con `pm2 restart porteria360`. Después, cada complejo se conecta desde **Expensas → Configuración → Conectar con Mercado Pago**.

## 8. Actualizar a una versión nueva

```bash
cd /var/www/porteria360 && git pull
npm run install:all && npm run build
cd backend && npm run db:migrate && cd ..
pm2 restart porteria360
```

## 9. Respaldos

- **Base de datos:** `mysqldump -u porteria360 -p porteria360 | gzip > /root/backups/porteria360-$(date +%F).sql.gz` (programalo con `crontab -e`).
- **Archivos subidos:** `backend/uploads/` (logos, galería, comprobantes de pago y de gastos).
- **Snapshot del VPS** desde el panel de Hostinger antes de cada actualización grande.

## Problemas frecuentes

| Síntoma | Causa / solución |
|---|---|
| `502 Bad Gateway` | El backend no está corriendo: `pm2 logs porteria360` (falta de `.env`, MySQL caído) |
| La cámara (DNI/QR) no abre | Requiere HTTPS: entrá siempre por `https://porteria360.net` |
| No llegan los avisos en tiempo real | Revisá que `/socket.io/` esté en la configuración de Nginx y `pm2 logs` |
| MercadoPago no acredita | La URL del webhook debe ser exactamente la de la tabla; mirá `pm2 logs` buscando `mp_webhook` |
| Error al subir video o comprobante grande | `client_max_body_size` (60 MB) en Nginx |

## 10. Rutas, `.env` y archivos estáticos (cómo funciona)

El backend **no depende del directorio de trabajo** (cwd). `backend/src/lib/paths.js` calcula todas las rutas a partir de su propia ubicación:

| Qué | Ruta real |
|---|---|
| Variables de entorno | `backend/.env` (único; lo carga `backend/src/lib/env.js`) |
| PWA compilada | `frontend/dist` (o `FRONTEND_DIST`, relativa a `backend/`) |
| Branding / privados / comprobantes | `backend/uploads/{tenants,private,receipts}` |
| Modelo OCR | `backend/.tesseract-cache` |

Da igual si PM2 arranca con cwd `backend/`, `backend/src` o `/`. **No copies el `.env` a `src/`** ni cambies rutas a mano.

Qué entrega Express en producción:

| Ruta | Respuesta | Caché |
|---|---|---|
| `/assets/*` (JS/CSS con hash) | archivo | 1 año, `immutable` |
| `/generated-assets/*` | imágenes WebP | 30 días |
| `/uploads/tenants/*` | branding del complejo | 7 días |
| `/sw.js`, `*.html`, `/manifest.webmanifest` | archivo | `no-cache` |
| Archivo inexistente (`/assets/viejo.css`, `/x.png`) | **404** (nunca HTML) | — |
| `/`, `/login`, `/guardia/...` (sin extensión) | PWA (`index.html` en `/`, `app.html` en el resto); refrescar funciona | `no-cache` |

### Migración en el VPS (una sola vez)

```bash
cd /var/www/proyectos-mysql/porteria360
rm -f backend/src/.env                         # la copia temporal; el válido es backend/.env
ls -l backend/.env                             # debe existir
git pull                                       # o subí los cambios (revierte el '../../frontend/dist' manual)
npm run install:all && npm run build           # build limpio: CSS completo y hashes nuevos
pm2 delete porteria360                         # quita la definición vieja (cwd backend/src)
pm2 start deploy/ecosystem.config.cjs && pm2 save
```

En el navegador: recargá con Ctrl+F5 (o *Borrar datos del sitio*) una vez, para descartar el service worker anterior.

### Verificación

```bash
pm2 describe porteria360 | grep -E "script path|exec cwd|status"
pm2 logs porteria360 --lines 30 --nostream     # debe decir: [static] PWA servida desde .../frontend/dist
curl -s http://127.0.0.1:5007/api/health        # {"ok":true}
CSS=$(ls frontend/dist/assets/*.css | head -1 | xargs basename)
curl -sI http://porteria360.net/assets/$CSS | grep -iE "^HTTP|content-type|cache-control"   # 200 text/css immutable
curl -sI http://porteria360.net/assets/no-existe.js | head -1                                # 404
curl -sI http://porteria360.net/guardia | grep -iE "^HTTP|content-type"                       # 200 text/html
curl -sI http://porteria360.net/sw.js | grep -i cache-control                                 # no-cache
curl -sI http://porteria360.net/manifest.webmanifest | grep -iE "^HTTP|content-type"
grep -oE '/assets/[^"]+\.css' frontend/dist/index.html   # debe coincidir con $CSS
ls -la frontend/dist frontend/dist/assets | head; find backend/uploads -maxdepth 2 | head
find / -name .env -path "*porteria360*" -not -path "*/node_modules/*" 2>/dev/null   # solo backend/.env
```

Checklist: ☐ un solo `.env` (backend/) · ☐ CSS 200 `text/css` · ☐ asset inexistente 404 · ☐ refrescar `/guardia` muestra la app · ☐ logos de complejos visibles · ☐ `pm2 logs` sin errores · ☐ `/socket.io` conecta (tiempo real).
