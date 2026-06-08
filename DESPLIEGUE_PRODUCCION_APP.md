# Despliegue y operación de la aplicación (MALI WhatsApp MVP)

Guía centrada en **arquitectura, infraestructura, despliegue, variables de entorno, roles, Docker, proxy y uso del panel**. La integración con Meta (Developers, Business Manager, webhooks, `subscribed_apps`, SMS/register manual) está en **[CONFIGURACION_META.md](./CONFIGURACION_META.md)**.

---

## Índice

1. [Objetivo, alcance y principios operativos](#1-objetivo-alcance-y-principios-operativos)
2. [Orden lógico de despliegue](#2-orden-lógico-de-despliegue)
3. [Arquitectura](#3-arquitectura)
4. [Flujo Git (desarrollo y servidor)](#4-flujo-git-desarrollo-y-servidor)
5. [Infraestructura en el servidor](#5-infraestructura-en-el-servidor)
6. [Credenciales, variables `.env` y producción](#6-credenciales-variables-env-y-producción)
7. [Seguridad en producción](#7-seguridad-en-producción)
8. [Despliegue: Docker](#8-despliegue-docker)
9. [Despliegue: Nginx Proxy Manager](#9-despliegue-nginx-proxy-manager)
10. [Configuración operativa (panel)](#10-configuración-operativa-panel)
11. [Rol master, áreas y credenciales](#11-rol-master-áreas-y-credenciales)
12. [Plantillas: ejemplo operativo (invitación Patronato / MALI)](#12-plantillas-ejemplo-operativo-invitación-patronato--mali)
13. [Uso operativo por módulo](#13-uso-operativo-por-módulo)
14. [Errores frecuentes (aplicación y ritmo)](#14-errores-frecuentes-aplicación-y-ritmo)
15. [Procedimiento: sandbox → piloto → masivo](#15-procedimiento-sandbox--piloto--masivo)
16. [Troubleshooting (app y base de datos)](#16-troubleshooting-app-y-base-de-datos)
17. [Go-live: lista bloqueante](#17-go-live-lista-bloqueante)
18. [Mejoras posteriores (no bloqueantes)](#18-mejoras-posteriores-no-bloqueantes)

---

## 1. Objetivo, alcance y principios operativos

- Operar campañas con WhatsApp Cloud API usando el MVP actual.
- Dejar operativos: **Enviar campaña** (sincronización de plantillas Meta), **Contactos**, **Historial**, **Ajustes** (segmentos).
- Validar un flujo real: prueba → piloto → envío masivo controlado.

**Principios (operación diaria):** priorizar **facilidad de uso** frente a sobreingeniería. Donde este documento habla del usuario **master**, asume un **único operador** de ese rol: no hace falta diseñar permisos complejos, auditorías ni catálogos dinámicos de “áreas” para el día a día.

Los valores que obtienes en Meta (token, phone number ID, WABA, verify token) se documentan en **[CONFIGURACION_META.md](./CONFIGURACION_META.md)**.

---

## 2. Orden lógico de despliegue

Respeta este orden para evitar errores (especialmente en el webhook):

1. **Dominio y DNS** apuntando al servidor.
2. **Docker** en el servidor y red compartida con el proxy (si usas Nginx Proxy Manager).
3. **Proxy inverso + SSL (HTTPS)** para el host público (p. ej. `whatsapp.mali.pe`).
4. **Aplicación y Postgres** levantados (`docker compose`), `.env` completo en el host.
5. **Comprobar** `/health` por HTTPS.
6. **Solo entonces** registrar el **webhook** en Meta (Meta exige HTTPS en la callback URL). Detalle: [CONFIGURACION_META.md](./CONFIGURACION_META.md).
7. Plantillas en WhatsApp Manager y **Sincronizar plantillas** en el panel.

Si configuras el webhook en Meta antes de que la URL HTTPS responda bien, la verificación fallará.

---

## 3. Arquitectura

- Aplicación: `app/server.js` (Node.js + Express + EJS).
- Base de datos: PostgreSQL; el esquema se crea/actualiza al arrancar la app (`app/src/db/migrations.js`). `db/init.sql` es solo referencia.
- Despliegue: `docker-compose.yml` + `Dockerfile`.
- Webhook (Meta):
  - Verificación: `GET /webhook` (singular; **no** uses `/webhooks`).
  - Eventos: `POST /webhook`

Comportamiento y suscripción `subscribed_apps`: [CONFIGURACION_META.md](./CONFIGURACION_META.md).

---

## 4. Flujo Git (desarrollo y servidor)

### En tu máquina (desarrollo)

1. `git status` — revisa cambios locales.
2. `git pull origin <rama>` — integra el remoto (p. ej. `main`).
3. Commits con mensajes claros; `git push origin <rama>`.

### En el servidor (producción)

1. Entra al directorio del repositorio (donde está `docker-compose.yml`).
2. `git fetch origin && git pull origin <rama>` — mismo código que en el remoto.
3. Si cambiaste `Dockerfile`, `package.json` o dependencias: reconstruye la imagen (ver sección Docker).

**Buenas prácticas**

- El archivo **`.env` no se versiona** (debe estar en `.gitignore`). En el servidor, mantén una copia de respaldo en lugar seguro.
- Tras `git pull`, si solo cambió código de aplicación: `docker compose up -d --build` suele ser suficiente para desplegar.

---

## 5. Infraestructura en el servidor

- **Docker** y **Docker Compose** instalados.
- Red externa de Nginx Proxy Manager: el `docker-compose.yml` de producción usa la red `nginx-proxy-manager_default`. Debe existir antes de levantar la app:
  - `docker network ls` — busca `nginx-proxy-manager_default` (suele crearse al instalar/levanter NPM al menos una vez).
- **Nginx Proxy Manager (NPM):** Proxy Host del dominio público → contenedor `mali-whatsapp-app:3000` en la **misma red Docker** que NPM (ver sección 9).
- **SSL (Let’s Encrypt en NPM)** activo para ese host **antes** de registrar el webhook en Meta.

---

## 6. Credenciales, variables `.env` y producción

Completa un archivo **`.env`** en la **raíz del proyecto** (en el servidor, junto al `docker-compose.yml`; no lo subas a Git). Puedes partir de `.env.example`.

**Origen en Meta** de cada valor sensible: [CONFIGURACION_META.md § Credenciales y mapa](./CONFIGURACION_META.md#credenciales-y-mapa-meta--entorno).

### Mapa rápido “dónde lo copio en Meta”

| Variable `.env` | Origen típico en Meta / infra |
|-----------------|--------------------------------|
| `APP_BASE_URL` | URL pública HTTPS **sin** barra final (`https://whatsapp.mali.pe`) |
| `BASE_PATH` | Vacío si la app está en la raíz del dominio |
| `VERIFY_TOKEN` | Texto que **tú defines** en Webhook → Verify token (mismo valor) |
| `APP_SECRET` | App → Configuración → Básica → App Secret |
| `WHATSAPP_TOKEN` / `WHATSAPP_TOKEN_PAM` / `WHATSAPP_TOKEN_PATRONATO` / `WHATSAPP_TOKEN_EDUCACION` | Token de la API (Graph) con permisos WhatsApp |
| `PHONE_NUMBER_ID` / `PHONE_NUMBER_ID_PAM` / `PHONE_NUMBER_ID_PATRONATO` / `PHONE_NUMBER_ID_EDUCACION` | WhatsApp → API Setup → **Phone number ID** |
| `WABA_ID_PAM` / `WABA_ID_PATRONATO` / `WABA_ID_EDUCACION` | Opcional: ID de cuenta WhatsApp Business si la app no deduce el WABA |

### Tabla ampliada de variables

| Variable | Uso |
|----------|-----|
| `PORT` | Puerto interno del contenedor (p. ej. `3000`). |
| `NODE_ENV` | `production` en servidor. |
| `APP_BASE_URL` | URL pública HTTPS **sin** barra final. |
| `BASE_PATH` | Vacío (`BASE_PATH=`) si la app está en la raíz del host. |
| `REQUIRE_AUTH` | `true` en producción para login con correo `@mali.pe`. |
| `SESSION_SECRET` | Secreto para firmar la cookie de sesión (obligatorio si `REQUIRE_AUTH=true`). |
| `DEV_AREA` | Solo desarrollo sin auth: `ti`, `pam`, `patronato` o `educacion`. |
| `VERIFY_TOKEN` | Igual que el **Verify token** del webhook en Meta. |
| `APP_SECRET` | Firma `X-Hub-Signature-256` del webhook. |
| `REQUIRE_WEBHOOK_SIGNATURE` | `true` en producción recomendado. |
| `WHATSAPP_TOKEN` | Respaldo si no usas sufijos por área. |
| `PHONE_NUMBER_ID` | Respaldo si no usas sufijos por área. |
| `WHATSAPP_TOKEN_PAM` / `WHATSAPP_TOKEN_PATRONATO` / `WHATSAPP_TOKEN_EDUCACION` | Token por área (PAM nuevo / Patronato / Educación). |
| `PHONE_NUMBER_ID_PAM` / `PHONE_NUMBER_ID_PATRONATO` / `PHONE_NUMBER_ID_EDUCACION` | Phone number ID por área. |
| `WABA_ID_PAM` / `WABA_ID_PATRONATO` / `WABA_ID_EDUCACION` | Opcional si falla la detección automática del WABA. |
| `POSTGRES_*` / `DATABASE_URL` | Credenciales de PostgreSQL (compose usa servicio `postgres`). |
| `WEBHOOK_DEBUG` | `true` temporalmente para logs de estructura del webhook (quitar tras diagnosticar). |

### URL pública en producción (dominio dedicado)

Producción MALI: **`https://whatsapp.mali.pe`**

```env
BASE_PATH=
APP_BASE_URL=https://whatsapp.mali.pe
```

- `BASE_PATH`: vacío cuando la app está en la **raíz** del host (recomendado con subdominio dedicado).
- `APP_BASE_URL`: URL que ve el usuario y Meta; **sin** barra final.

En local (Docker dev o sin proxy): `BASE_PATH` vacío y `APP_BASE_URL=http://localhost:3000`.

**Nota:** Si montaras la app bajo una subruta (p. ej. `/whatsapp`), entonces `BASE_PATH=/whatsapp` y `APP_BASE_URL` incluiría esa ruta; el proxy debe reescribir rutas según corresponda.

### Variables opcionales de plantillas y lotes

Valores por defecto en `app/server.js` y en el panel **Configuración**; revisa `.env.example` y el panel para `TEMPLATE_BODY_VARIABLE_*`, límites de lote, etc.

---

## 7. Seguridad en producción

### Recomendado en producción

- `NODE_ENV=production`
- `REQUIRE_AUTH=true` + `SESSION_SECRET` (login con correo **@mali.pe** y sesión)
- `REQUIRE_WEBHOOK_SIGNATURE=true`
- `RATE_LIMIT_MAX=300` (u otro según tu proxy)
- `CAMPAIGN_RATE_LIMIT_MAX=5`
- Usuarios adicionales:  
  `docker compose exec app sh -c 'cd /usr/src/app && node scripts/create-user.js "correo@mali.pe" "clave" pam'`  
  (ver `README.md`; último argumento opcional `master` para usuario master).

### Antes de salir a producción

1. Rotar cualquier token o clave que haya estado expuesto.
2. Confirmar que `.env` no se versiona (`.gitignore` en raíz).
3. Contraseña fuerte para los usuarios del panel (correos `@mali.pe`).
4. No compartir secretos por canales inseguros.
5. Mantener `APP_SECRET` y validación de firma del webhook activos.

---

## 8. Despliegue: Docker

### Producción (`docker-compose.yml`)

- **No** publica puertos en el host: la app habla con Postgres en la red interna y se expone a **Nginx Proxy Manager** por la red externa `nginx-proxy-manager_default`.
- Esa red debe existir antes (`docker network ls`); suele crearse al levantar NPM al menos una vez.
- Carga variables desde `.env` en la raíz (`env_file: .env`).

```bash
docker compose up -d --build
```

Tras **editar solo `.env`**, suele bastar recrear el servicio para recargar variables:

```bash
docker compose up -d
```

Si el contenedor no toma los cambios, prueba: `docker compose up -d --force-recreate app`.

### Script recomendado (backup + despliegue)

En el servidor, desde la raíz del repo (`~/mali-whatsapp`):

```bash
chmod +x scripts/*.sh
./scripts/deploy-production.sh          # backup → pull → build → up → /health
./scripts/deploy-production.sh --no-cache   # rebuild completo de la imagen
./scripts/backup-postgres.sh            # solo respaldo (sin desplegar)
```

- Los volcados quedan en `backups/postgres/` (no se versionan; copia periódica fuera del EC2, p. ej. S3).
- Por defecto se conservan los **14** últimos respaldos (`KEEP_BACKUPS=14`).
- **Restaurar** (solo si hace falta rollback de datos):

```bash
gunzip -c backups/postgres/mali_whatsapp_YYYYMMDD_HHMMSS.sql.gz \
  | docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

(Usa las variables del contenedor Postgres o las de tu `.env`.)

**Cron diario** (respaldo a las 03:00, sin desplegar):

```cron
0 3 * * * cd /home/ubuntu/mali-whatsapp && ./scripts/backup-postgres.sh >> /var/log/mali-whatsapp-backup.log 2>&1
```

### Desarrollo local (hot reload)

```bash
docker compose -f docker-compose.dev.yml up --build
```

Panel en **`http://localhost:3000`** (puertos publicados; no usa la red NPM).

### Comprobar salud

- **Con puerto local** (dev): `curl -i http://localhost:3000/health` → `200` y `{"ok":true,"db":"up"}`.
- **En servidor** (HTTPS): `curl -sS "https://whatsapp.mali.pe/health"` (ajusta el dominio).

---

## 9. Despliegue: Nginx Proxy Manager

URL pública del MVP: **`https://whatsapp.mali.pe`**.

Crea un **Proxy Host** para `whatsapp.mali.pe` que apunte al contenedor **`mali-whatsapp-app:3000`** (misma red Docker que NPM). Con dominio dedicado suele bastar el formulario de NPM (**Forward Hostname / IP** + puerto), sin subruta.

Si necesitas bloque Nginx personalizado (equivalente a raíz):

```nginx
location / {
    proxy_pass http://mali-whatsapp-app:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

- `mali-whatsapp-app` y puerto `3000` deben coincidir con tu `docker-compose` y red Docker compartida con NPM.

### SSL

Activa HTTPS (Let’s Encrypt en NPM) **antes** de registrar el webhook en Meta.

---

## 10. Configuración operativa (panel)

Validar operativamente:

- Token de acceso vigente.
- Phone Number ID correcto.
- WABA alineado con Meta (o `WABA_ID_*` en `.env` si hace falta).
- Verify token y App Secret coherentes con Meta y con `.env`.
- Versión de API coherente con el backend (`GRAPH_API_VERSION` en código).

**Checklist rápido:** `WHATSAPP_TOKEN_*`, `PHONE_NUMBER_ID_*`, y en el panel **Sincronizar plantillas** para cargar plantillas aprobadas antes de enviar campañas.

---

## 11. Rol master, áreas y credenciales

Pensado para **un único operador master** (tú). Herramientas opcionales en el panel; el script `scripts/create-user.js` y el **`.env`** siguen siendo válidos.

### Área activa y master

- **Área** (`ti` | `pam` | `patronato` | `educacion`): filtra campañas, contactos e historial. Viene del usuario al login y se guarda en sesión.
- **Usuario master** (`is_master` en `users`): ve la barra lateral **Admin** (Usuarios, Credenciales Meta) y el **selector de área** en la barra superior. Al cambiar de área se actualizan sesión y fila del usuario master en BD para que no queden desalineados.
- **Patronato** conserva el número e historial que antes estaban bajo PAM; **PAM** es la línea comercial nueva (sin datos migrados).

### Usuarios del panel

- **CRUD mínimo (solo master):** rutas **`/admin/users`** — listado, alta, edición (área, master, contraseña opcional), eliminación (no puedes borrar tu propia sesión activa).
- Alternativa: **`node scripts/create-user.js`** como hasta ahora.

### Credenciales Meta: `app_settings` + `.env`

- La app lee primero **`app_settings`** (claves `meta.*`; área `global` para verify token y app secret; `ti` / `pam` / `patronato` / `educacion` para token, phone number ID y WABA por área). Si un valor **no está en BD**, se usa **`process.env`** como hasta ahora.
- **Pantalla (solo master):** **`/admin/meta`** — guardar actualiza BD y refresca la caché en memoria; **dejar un campo vacío y guardar** borra el override en BD y vuelve a aplicar solo `.env`.
- Tras cambios solo en **`.env`**, recarga del contenedor según sección 8 (no hace falta entrar al panel).

### Áreas fijas y migración PAM → Patronato

- El esquema admite **cuatro** áreas: `ti`, `pam`, `patronato`, `educacion`. No se crean áreas dinámicas desde el panel.
- Al desplegar la versión con migración `pam_to_patronato_v1`, todo el historial que estaba en `pam` pasa a **`patronato`** (incluye credenciales Meta en BD). **`pam`** queda vacío para el número nuevo.
- **Post-deploy:** en **Admin → Credenciales Meta**, confirma Patronato (número viejo) y carga PAM (número nuevo). Actualiza `.env`: `*_PATRONATO` para el número anterior; `*_PAM` para el nuevo. Ejecuta `subscribed_apps` en Meta para la WABA del PAM nuevo.

---

## 12. Plantillas: ejemplo operativo (invitación Patronato / MALI)

WhatsApp **no** permite texto largo libre en frío: hace falta una **plantilla aprobada**. El texto fijo va en la plantilla; lo variable son `{{1}}`, `{{2}}`, … rellenados desde el panel. Creación y estados en Meta: [CONFIGURACION_META.md](./CONFIGURACION_META.md).

### Qué crear en WhatsApp Manager

1. **Categoría**: según políticas actuales (p. ej. Marketing o Utility).
2. **Header**: tipo **Imagen** si usarás imagen por URL en el envío.
3. **Body**: texto fijo + el **número exacto** de variables y su **orden**.

### Ejemplo alineado con `.env` por defecto (4 variables)

```env
TEMPLATE_BODY_VARIABLE_COUNT=4
TEMPLATE_BODY_VARIABLE_1_FROM_CONTACT=false
TEMPLATE_BODY_VARIABLE_LABELS=Fecha y hora del evento,Dirección completa,Link RSVP,Nota o recordatorio
```

Ejemplo de cuerpo en Meta (el texto fijo es tuyo; `{{n}}` debe coincidir en número y orden):

```
Estimados miembros del Patronato de las Artes,

En nombre del Museo de Arte de Lima, nos complace invitarlos a un cóctel en casa de Alexandra Bryce, Vicepresidenta del museo, para celebrar el Patronato del MALI y compartir con ustedes nuestros proyectos para el 2026.

Será una ocasión especial para reencontrarnos y expresarles nuestro sincero agradecimiento por su constante apoyo al museo.

Los esperamos el {{1}}.

Alberto Rebaza
Presidente
Alexandra Bryce
Vicepresidenta

Dirección
{{2}}

RSVP {{3}}
{{4}}
```

| Variable | Ejemplo de contenido |
|----------|----------------------|
| `{{1}}` | `lunes 20 de abril de 2026, a las 7 p.m.` |
| `{{2}}` | `Av Pezet 561. Apt 302, San Isidro` |
| `{{3}}` | `https://www.addevent.com/event/clt2hdpl87jz` |
| `{{4}}` | `Confirmar si irá con acompañante` |

Respeta el **límite de caracteres** del body en WhatsApp Manager.

### Imagen en el envío

Ejemplo de URL pública (header imagen en Meta + campo **URL pública de imagen** en el panel):

`https://mali.pe/es/wp-content/uploads/2026/03/Coctel_Patronato.jpeg`

- Si la plantilla **no** tiene header imagen, deja el campo vacío.

### Cambios solo en fecha, hora o enlace

No hace falta cambiar código: actualizas valores en el formulario de cada campaña.

Si cambias **cuántas variables** tiene la plantilla en Meta, actualiza `TEMPLATE_BODY_VARIABLE_COUNT` y `TEMPLATE_BODY_VARIABLE_LABELS` (misma cantidad de etiquetas que variables de formulario).

Para que `{{1}}` sea el nombre del contacto: `TEMPLATE_BODY_VARIABLE_1_FROM_CONTACT=true` y en Meta el texto debe usar `{{1}}` donde iría el nombre.

---

## 13. Uso operativo por módulo

### Contactos

- `name`: obligatorio, máx. 120 caracteres.
- `phone`: E.164 **sin** `+` (solo dígitos, 8–15).
- `segment`: definido por **segmentos** en Ajustes (`suscriptor_1`, etc., según tu configuración).

Recomendación: empezar con un piloto pequeño (5–20 contactos) y tener opt-in claro.

### Plantillas (reglas)

- Solo plantillas **aprobadas** en Meta; se listan tras **Sincronizar plantillas**.
- La estructura (cabecera, cuerpo, botones) se infiere de Meta; no hace falta configurar variables a mano en muchos casos.

### Enviar campaña

1. **Sincronizar plantillas** (si hace falta actualizar la lista).
2. Elegir segmento y plantilla en el desplegable.
3. Rellenar los campos que pida la plantilla (textos, URL de media, etc.).
4. Lote y pausa: `batchSize` 1–100, `batchDelayMs` 0–60000.

Buenas prácticas: empezar con `batchSize=10` y `batchDelayMs=1500`; subir volumen tras validar entrega y lectura en historial.

### Historial

- Conteos `sent`, `delivered`, `read`, `failed`.
- Errores con código de Graph API.
- Estados actualizados vía webhook.

Ante errores HTTP: `401/403` → token/permisos; `429` → bajar ritmo; `5xx` de Meta → reintentar con cuidado.

---

## 14. Errores frecuentes (aplicación y ritmo)

| Código / síntoma | Causa probable | Qué revisar |
|------------------|----------------|-------------|
| **132000** | Parámetros distintos a los que espera la plantilla | Vuelve a sincronizar plantillas y rellena todos los campos del formulario |
| **132001** | Nombre o idioma de plantilla incorrecto | Nombre exacto y `languageCode` aprobado |
| Muchos errores por límite | Ritmo alto | Reducir `batchSize`, aumentar `batchDelayMs` |

Códigos Meta (**133010**, **131030**, webhook, `subscribed_apps`): [CONFIGURACION_META.md § Errores](./CONFIGURACION_META.md#errores-frecuentes-meta-y-webhook).

---

## 15. Procedimiento: sandbox → piloto → masivo

### Fase A — Sandbox

- [ ] Healthcheck OK (`/health` por HTTPS).
- [ ] Webhook verificado por Meta (GET con challenge). [CONFIGURACION_META.md](./CONFIGURACION_META.md)
- [ ] Plantilla de prueba (`hello_world`) funcionando.
- [ ] Envío a un número permitido.

### Fase B — Piloto

- [ ] 5–20 contactos reales con opt-in.
- [ ] Monitoreo de estados 30–60 min.
- [ ] Tasa de error aceptable.

### Fase C — Masivo controlado

- [ ] Ejecutar por segmentos, no todo en un solo disparo.
- [ ] Observar errores en tiempo real.
- [ ] Si sube la tasa de error, pausar y ajustar lotes.

---

## 16. Troubleshooting (app y base de datos)

- **Plantilla**: nombre e idioma exactos; parámetros alineados con la plantilla en Meta.
- **Rendimiento**: lotes más pequeños y más delay entre lotes.

### Webhook y áreas (`pam` / `patronato` / `educacion`)

Si no ves mensajes entrantes en el chat aunque envíes campañas bien, el problema suele ser **Meta** (suscripción `subscribed_apps` por WABA), no el mapeo de área en base de datos. Ver [CONFIGURACION_META.md § Varias WABA y webhooks](./CONFIGURACION_META.md#varias-waba-y-por-qué-solo-una-línea-recibe-webhooks).

En logs de la app: busca `Webhook inbound guardado` o `no se pudo resolver area`. Si `metadata.phone_number_id` viene vacío, puede ayudar **`WABA_ID_*`** alineado con `entry.id` del JSON.

---

## 17. Go-live: lista bloqueante

- [ ] Secretos rotados y `.env` protegido.
- [ ] `REQUIRE_AUTH` y `SESSION_SECRET` activos; usuarios con correo `@mali.pe`.
- [ ] Firma de webhook obligatoria en producción.
- [ ] Plantilla aprobada y validada en piloto.
- [ ] Healthcheck y base de datos estables.
- [ ] Primera campaña piloto con trazabilidad en historial.

---

## 18. Mejoras posteriores (no bloqueantes)

- Cola de envíos con reintentos y backoff.
- Alertas y métricas (entrega/error por campaña).
- Pruebas automatizadas de rutas críticas.
- Cifrado en reposo para secretos en `app_settings` (opcional, si el riesgo lo justifica).
