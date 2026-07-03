# Despliegue v2 — cutover en `whatsapp.mali.pe`

Runbook para **reemplazar el panel legacy** (Express + EJS en `app/`) por **NestJS + React**, en el **mismo dominio** y la **misma base de datos** PostgreSQL de producción.

Relacionado: [ARRANQUE_V2.md](./ARRANQUE_V2.md), [CONFIGURACION_META.md](./CONFIGURACION_META.md), [DESPLIEGUE_PRODUCCION_APP.md](./DESPLIEGUE_PRODUCCION_APP.md) (legacy, referencia operativa).

---

## Resumen del cambio

| Antes (legacy) | Después (v2) |
|----------------|--------------|
| Contenedor `app` (Express, puerto 3000) | Contenedores `web` (nginx :80) + `api` (Nest :4000) |
| Sesión + `SESSION_SECRET` | JWT (`JWT_SECRET`) + login contraseña y/o Google OAuth |
| Workers en proceso Node (`setInterval`) | **Redis** + BullMQ (campañas, reintentos, purge bitácora) |
| Esquema vía `migrations.js` al arrancar | Prisma Migrate (`prisma migrate deploy` al arrancar API) |
| Misma URL webhook | `GET/POST https://whatsapp.mali.pe/webhook` (sin cambiar en Meta) |

**No se migran datos:** contactos, campañas, usuarios y `app_settings` permanecen en la BD existente.

---

## Arquitectura en producción

```txt
Usuario / Meta
      │
      ▼
Nginx Proxy Manager (HTTPS :443)
      │
      ▼
mali-whatsapp-web:80  (React estático + proxy nginx)
      ├── /           → SPA
      ├── /api/*      → mali-whatsapp-api:4000
      ├── /health     → api
      └── /webhook    → api  (sin prefijo /api)

mali-whatsapp-api:4000
      ├── PostgreSQL (misma BD)
      └── Redis (nuevo, obligatorio)
```

---

## Fase 0 — Pre-requisitos

- [ ] Rama `migrate/v2` mergeada o desplegada desde el commit acordado.
- [ ] Backup reciente de PostgreSQL (`./scripts/backup-postgres.sh`).
- [ ] Red Docker `nginx-proxy-manager_default` existente (`docker network ls`).
- [ ] Credenciales Meta, S3 y `.env` de producción revisados (ver sección Variables).
- [ ] Ventana de mantenimiento acordada (minutos; el webhook deja de responder mientras el contenedor legacy está parado).

---

## Fase 1 — Staging (recomendado)

Objetivo: validar v2 contra **copia** de la BD de producción (o la misma estructura), sin tocar tráfico real.

1. Restaurar backup en un Postgres de staging (o `docker compose -f docker-compose.dev.yml` en otra máquina).
2. Configurar `.env` de staging con `APP_BASE_URL` del host de prueba.
3. Marcar migración inicial como aplicada (BD ya creada por legacy):

   ```bash
   cd api
   DATABASE_URL="postgresql://..." npx prisma migrate resolve --applied 20260702120000_init
   ```

4. Levantar stack v2:

   ```bash
   docker compose up -d --build
   ```

5. Checklist funcional por área (no tiene que ser perfecto; los detalles de UI se corrigen después):

   - [ ] Login (contraseña y/o Google si está configurado).
   - [ ] Dashboard, contactos, segmentos, plantillas (sync Meta).
   - [ ] Crear campaña piloto (sin enviar masivo).
   - [ ] Inbox: listar conversación y enviar mensaje de prueba.
   - [ ] Webhook: `curl -sS "https://STAGING/health"` y verificación GET de Meta.
   - [ ] Admin: usuarios, credenciales Meta.
   - [ ] Media en chat carga desde S3 (bucket y política públicas).

---

## Fase 2 — Preparar `.env` de producción

Partir del `.env` actual y **añadir/actualizar** (no quitar credenciales Meta ni Postgres existentes):

```env
NODE_ENV=production
APP_BASE_URL=https://whatsapp.mali.pe
BASE_PATH=

# Auth v2
REQUIRE_AUTH=true
JWT_SECRET=<cadena aleatoria larga, mín. 32 caracteres>
JWT_EXPIRES_IN=7d

# Redis (nuevo, obligatorio)
REDIS_URL=redis://redis:6379

# S3 (obligatorio en v2 para adjuntos de chat)
ACCESS_KEY_S3=...
SECRET_KEY_S3=...
BUCKET_NAME=...
CARPETA=...
AWS_REGION=us-east-1
# S3_PUBLIC_URL_BASE=...   # opcional CDN

# Google OAuth (opcional; si se activa, las tres variables son obligatorias)
# GOOGLE_CLIENT_ID=...
# GOOGLE_CLIENT_SECRET=...
# GOOGLE_CALLBACK_URL=https://whatsapp.mali.pe/api/auth/google/callback
# ALLOWED_DOMAIN=mali.pe
# COOKIE_DOMAIN=whatsapp.mali.pe

# API
API_PORT=4000
DATABASE_URL=postgresql://USER:PASS@postgres:5432/mali_whatsapp
```

**Ya no usa v2:** `SESSION_SECRET` (solo legacy). Puede quedarse en `.env` sin efecto.

**Webhook / Meta:** `VERIFY_TOKEN`, `APP_SECRET`, `REQUIRE_WEBHOOK_SIGNATURE=true`, tokens WhatsApp por área — **igual que antes**. La callback URL en Meta sigue siendo `https://whatsapp.mali.pe/webhook`.

**Tras el cutover:** quitar `MASTER_INITIAL_PASSWORD` del servidor si existía (el seed v2 solo crea master si no hay usuario).

---

## Fase 3 — Base de datos (misma BD, sin recrear)

La migración `20260702120000_init` describe el esquema **completo** introspectado del legacy. En producción **no debe ejecutarse** sobre tablas ya existentes.

### Una sola vez, antes del primer arranque de la API v2

Con la BD accesible (contenedor postgres levantado o URL de prod):

```bash
docker compose run --rm api npx prisma migrate resolve --applied 20260702120000_init
```

Esto registra en `_prisma_migrations` que el esquema inicial ya está aplicado.

### Migraciones futuras

Cualquier columna nueva en v2 se añadirá como migración incremental (`api/prisma/migrations/YYYYMMDD_nombre/`). Al arrancar, `docker-entrypoint.sh` ejecuta `prisma migrate deploy` y solo aplica deltas.

### Si `migrate deploy` falla al arrancar

- Error tipo «relation already exists» → falta el `migrate resolve` anterior.
- Revisar logs: `docker compose logs api --tail 100`.

---

## Fase 4 — Cutover en el servidor

Ejecutar en la raíz del repo (`~/mali-whatsapp` o ruta equivalente).

### 1. Respaldo

```bash
./scripts/backup-postgres.sh
```

### 2. Código v2

```bash
git fetch origin
git pull origin migrate/v2   # o la rama acordada
```

### 3. Parar legacy

```bash
docker compose stop app 2>/dev/null || true
docker compose rm -f app 2>/dev/null || true
```

(Si el servicio legacy tenía otro nombre, parar ese contenedor.)

### 4. Prisma resolve (si no se hizo en staging)

```bash
docker compose run --rm api npx prisma migrate resolve --applied 20260702120000_init
```

### 5. Levantar v2

```bash
docker compose up -d --build
```

Servicios: `api`, `web`, `postgres`, `redis`.

**Postgres:** si ya existía un volumen `postgres_data` del despliegue anterior, el compose v2 lo reutiliza (`docker volume ls`). No inicialices una BD vacía por error.

**Si Postgres corre fuera de este compose:** elimina o no levantes el servicio `postgres` del compose y apunta `DATABASE_URL` al host existente (ajuste manual del `docker-compose.yml` o override).

### 6. Actualizar Nginx Proxy Manager

Proxy Host `whatsapp.mali.pe`:

| Campo | Valor |
|-------|--------|
| Forward Hostname | `mali-whatsapp-web` |
| Forward Port | `80` |
| Esquema | `http` |
| Red Docker | `nginx-proxy-manager_default` (compartida con los contenedores v2) |

**Antes:** `mali-whatsapp-app:3000` (legacy).

SSL: mantener Let's Encrypt ya configurado.

### 7. Comprobaciones inmediatas

```bash
curl -sS https://whatsapp.mali.pe/health
# → {"ok":true,"db":"up"}

curl -sS -o /dev/null -w "%{http_code}" https://whatsapp.mali.pe/
# → 200 (SPA)

curl -sS -o /dev/null -w "%{http_code}" https://whatsapp.mali.pe/api/me
# → 401 sin token (esperado)
```

- Login en navegador con usuario existente de la BD.
- Meta Developers → Webhook → **Verificar** (GET challenge). No cambies la URL si sigue siendo `/webhook`.
- Enviar mensaje de prueba a un número y confirmar que aparece en Inbox.

---

## Fase 5 — Post-cutover

### Operación diaria

```bash
# Despliegue de cambios de código
git pull origin <rama>
docker compose up -d --build

# Solo variables .env
docker compose up -d --force-recreate api web
```

El script `scripts/deploy-production.sh` sigue orientado al contenedor legacy `app`; actualízalo o usa los comandos anteriores hasta adaptarlo.

### Usuarios

- Los usuarios en tabla `users` **siguen igual** (email, área, permisos, `password_hash`).
- Alta/edición: panel **Admin → Usuarios** (master) o script legacy `app/scripts/create-user.js` contra la misma BD.
- Google OAuth: solo cuentas `@mali.pe` **ya registradas** en `users`.

### Campañas en curso

- Campañas `sending` o `scheduled` al momento del cutover: revisar en lista de campañas tras el arranque; BullMQ reanuda trabajos al iniciar la API.
- Si algo quedó atascado: detalle de campaña → reintento manual.

### Rollback (solo emergencia)

1. Parar v2: `docker compose stop api web redis`.
2. Levantar legacy `app` (commit/ imagen anterior) apuntando a la **misma** `DATABASE_URL`.
3. Revertir NPM a `mali-whatsapp-app:3000`.

**Riesgo:** si v2 aplicó migraciones incrementales nuevas, el legacy podría no conocer columnas añadidas. Por eso el backup previo al cutover es obligatorio.

---

## Variables: mapa legacy → v2

| Legacy | v2 | Notas |
|--------|-----|--------|
| `SESSION_SECRET` | `JWT_SECRET` | Generar nuevo secreto JWT |
| `REQUIRE_AUTH` | `REQUIRE_AUTH` | `true` en prod |
| `PORT=3000` | `API_PORT=4000` | Puerto interno de Nest |
| — | `REDIS_URL` | **Nuevo**, obligatorio |
| — | `ACCESS_KEY_S3`, etc. | **Obligatorio** para media de chat |
| `POSTGRES_*`, `DATABASE_URL` | Igual | Misma BD |
| Meta / WhatsApp / Groq | Igual | Mismas claves |
| — | `GOOGLE_*` | Opcional OAuth |

---

## Checklist go-live (bloqueante)

- [ ] Backup PostgreSQL reciente y probado restore.
- [ ] `prisma migrate resolve --applied 20260702120000_init` ejecutado.
- [ ] `JWT_SECRET` y `REQUIRE_AUTH=true` en `.env`.
- [ ] `REDIS_URL` y contenedor `redis` healthy.
- [ ] S3 configurado y objetos `chat-media` legibles públicamente.
- [ ] NPM apunta a `mali-whatsapp-web:80`.
- [ ] `/health` OK por HTTPS.
- [ ] Login operativo (contraseña y/o Google).
- [ ] Webhook verificado en Meta (`REQUIRE_WEBHOOK_SIGNATURE=true`).
- [ ] Piloto: 1 campaña o 1 mensaje inbox en área real.
- [ ] `MASTER_INITIAL_PASSWORD` eliminado del `.env` de prod.

---

## Checklist no bloqueante (corrección continua)

- Ajustes visuales y UX en React.
- Botones o flujos secundarios.
- Informes y KPIs finos.
- Optimización de polling del inbox.

---

## Troubleshooting rápido

| Síntoma | Causa probable | Acción |
|---------|----------------|--------|
| API no arranca, error Prisma «already exists» | Falta `migrate resolve` | Ejecutar resolve (Fase 3) |
| 502 en el dominio | NPM apunta al contenedor viejo o red incorrecta | Verificar host `mali-whatsapp-web:80` y red NPM |
| Login 401 siempre | `JWT_SECRET` vacío o `REQUIRE_AUTH` mal configurado | Revisar `.env`, recrear `api` |
| Campañas no avanzan | Redis caído o `REDIS_URL` incorrecto | `docker compose ps redis`, logs `api` |
| Webhook Meta falla | `/webhook` no llega a API | Confirmar proxy en `web/nginx.conf` y NPM |
| Adjuntos rotos en chat | S3 o `S3_PUBLIC_URL_BASE` | Credenciales y política del bucket |
| Google OAuth error dominio | Cuenta no Workspace `@mali.pe` o no en `users` | Verificar `hd` y registro en Admin |

Logs:

```bash
docker compose logs api --tail 100 -f
docker compose logs web --tail 50
docker compose logs redis --tail 20
```

---

## Referencia de archivos

| Archivo | Uso |
|---------|-----|
| `docker-compose.yml` | Producción v2: api, web, postgres, redis |
| `web/nginx.conf` | Proxy `/api`, `/health`, `/webhook` → API |
| `api/scripts/docker-entrypoint.sh` | `migrate deploy` + `seed` + arranque Nest |
| `api/prisma/migrations/` | Migraciones (resolve init en BD existente) |
| `.env.example` | Plantilla completa de variables |

---

## Semana 46 — cierre

Tras cutover exitoso en `whatsapp.mali.pe`:

1. Marcar semana 46 completada en [MIGRACION_REACT.md](./MIGRACION_REACT.md).
2. Comunicar al equipo: nuevo login (JWT / Google), misma URL.
3. Mantener `app/` en repo solo como referencia; no volver a levantar en prod salvo rollback planificado.
