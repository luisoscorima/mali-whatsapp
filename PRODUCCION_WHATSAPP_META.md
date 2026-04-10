# Guía de producción y operación — WhatsApp API (MALI)

Documento único: requisitos, orden de despliegue, Git, Meta Developers, Docker, Nginx Proxy Manager, webhook, variables de entorno, plantillas, uso del panel, rol master (enfoque simple), errores frecuentes y checklist de salida a producción.

---

## Índice

1. [Objetivo, alcance y principios operativos](#1-objetivo-alcance-y-principios-operativos)
2. [Orden lógico de despliegue](#2-orden-lógico-de-despliegue)
3. [Arquitectura](#3-arquitectura)
4. [Flujo Git (desarrollo y servidor)](#4-flujo-git-desarrollo-y-servidor)
5. [Infraestructura en el servidor](#5-infraestructura-en-el-servidor)
6. [Meta Developers — paso a paso detallado](#6-meta-developers--paso-a-paso-detallado)
7. [Credenciales, variables `.env` y mapa Meta → entorno](#7-credenciales-variables-env-y-mapa-meta--entorno)
8. [Seguridad en producción y antes de salir a producción](#8-seguridad-en-producción-y-antes-de-salir-a-producción)
9. [Despliegue: Docker](#9-despliegue-docker)
10. [Despliegue: Nginx Proxy Manager](#10-despliegue-nginx-proxy-manager)
11. [Webhook: configuración en Meta y pruebas con `curl`](#11-webhook-configuración-en-meta-y-pruebas-con-curl)
12. [Configuración operativa (panel)](#12-configuración-operativa-panel)
13. [Rol master, áreas y credenciales (enfoque simple)](#13-rol-master-áreas-y-credenciales-enfoque-simple)
14. [Plantillas Meta: ejemplo invitación (Patronato / MALI)](#14-plantillas-meta-ejemplo-invitación-patronato--mali)
15. [Uso operativo por módulo](#15-uso-operativo-por-módulo)
16. [Errores frecuentes (API y plantillas)](#16-errores-frecuentes-api-y-plantillas)
17. [Procedimiento: sandbox → piloto → masivo](#17-procedimiento-sandbox--piloto--masivo)
18. [Troubleshooting rápido](#18-troubleshooting-rápido)
19. [Go-live: lista bloqueante](#19-go-live-lista-bloqueante)
20. [Mejoras posteriores (no bloqueantes)](#20-mejoras-posteriores-no-bloqueantes)

---

## 1. Objetivo, alcance y principios operativos

- Operar campañas con WhatsApp Cloud API usando el MVP actual.
- Configurar Meta Developers y el webhook de forma coherente con la **URL pública HTTPS**.
- Dejar operativos: **Enviar campaña** (sincronización de plantillas Meta), **Contactos**, **Historial**, **Ajustes** (segmentos).
- Validar un flujo real: prueba → piloto → envío masivo controlado.

**Principios (operación diaria):** priorizar **facilidad de uso** frente a sobreingeniería. Donde este documento habla del usuario **master**, asume un **único operador** de ese rol (tú): no hace falta diseñar permisos complejos, auditorías ni catálogos dinámicos de “áreas” para el día a día.

---

## 2. Orden lógico de despliegue

Respeta este orden para evitar errores (especialmente en el webhook):

1. **Dominio y DNS** apuntando al servidor.
2. **Docker** en el servidor y red compartida con el proxy (si usas Nginx Proxy Manager).
3. **Proxy inverso + SSL (HTTPS)** para el host público (p. ej. `whatsapp.mali.pe`).
4. **Aplicación y Postgres** levantados (`docker compose`), `.env` completo en el host.
5. **Comprobar** `/health` por HTTPS.
6. **Solo entonces** registrar el **webhook** en Meta (Meta exige HTTPS en la callback URL).
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
- **Nginx Proxy Manager (NPM):** Proxy Host del dominio público → contenedor `mali-whatsapp-app:3000` en la **misma red Docker** que NPM (ver sección 10).
- **SSL (Let’s Encrypt en NPM)** activo para ese host **antes** de registrar el webhook en Meta.

---

## 6. Meta Developers — paso a paso detallado

Entorno general: [Meta for Developers](https://developers.facebook.com/). Conviene tener acceso al **Meta Business** asociado al WhatsApp Business.

### 6.1 Crear la app

1. **Mis apps** → **Crear app**.
2. Tipo de caso de uso: **Negocio / Business** (según el asistente actual de Meta).
3. Completa nombre, email de contacto y vinculación a cuenta de negocio si lo solicita → **Crear app**.

### 6.2 Añadir el producto WhatsApp

1. En el panel de la app: **Añadir producto** (Add products).
2. Localiza **WhatsApp** → **Configurar** / **Set up**.

### 6.3 API Setup (credenciales de envío y plantillas)

En el menú lateral: **WhatsApp** → **Introducción** / **API Setup** / **Getting started** (el nombre puede variar ligeramente).

Anota o configura:

| En la pantalla de Meta | Uso en el MVP |
|------------------------|----------------|
| **Token de acceso** (temporal ~24 h o de larga duración) | Variable `WHATSAPP_TOKEN` o `WHATSAPP_TOKEN_PAM` / `WHATSAPP_TOKEN_EDUCACION` |
| **Phone number ID** (ID numérico largo; **no** es el número +51…) | `PHONE_NUMBER_ID` o `PHONE_NUMBER_ID_PAM` / `PHONE_NUMBER_ID_EDUCACION` |
| **WhatsApp Business Account ID (WABA)** | Opcional: `WABA_ID_PAM` / `WABA_ID_EDUCACION` si falla la detección automática al sincronizar plantillas |
| Números de **prueba** / lista de destinatarios permitidos | En modo desarrollo, solo esos números reciben mensajes |

**Token de larga duración (recomendado en producción):** Meta cambia la interfaz con frecuencia; suele obtenerse desde **Administrador comercial** (usuarios del sistema y permisos sobre el activo de WhatsApp) o desde el flujo de generación de token en la sección WhatsApp de la app. El token debe permitir envío y gestión de plantillas según tu caso.

### 6.4 Registrar el número en Cloud API (`register`) — paso crítico

Si el número aparece **Pendiente** en Business Suite / WhatsApp Manager y los envíos fallan con **`(#133010) Account not registered`**, muchas veces falta este paso: **registrar el número de teléfono** contra la API de WhatsApp Cloud usando el **Phone number ID** y el **PIN de verificación en dos pasos** que configuraste para ese número en Meta (no es el token de la app).

**Requisitos previos**

- Tener definido el **PIN de 6 dígitos** (dos pasos / two-step verification) para el número en el flujo de Meta (WhatsApp Manager o pestaña del número en Developers), según lo que pida la interfaz.
- Usar un **token** con permisos para gestionar ese número (mismo token que usas para enviar, con alcance al activo correcto).
- Sustituir `{PHONE_NUMBER_ID}` por el ID numérico de **API Setup** (no el +51 ni el WABA). La versión de la API en la URL puede ser la que uses en el proyecto (p. ej. `v20.0` o `v23.0`).

**1) Solicitar código por SMS (opcional)**

Solo si Meta aún no ha verificado la propiedad del número:

```bash
curl -X POST "https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}/request_code" \
  -H "Authorization: Bearer {TOKEN}" \
  -F "code_method=SMS" \
  -F "language=es"
```

Si la respuesta indica **«Número de teléfono ya verificado»** (error OAuth, código **136024**, subcódigo **2388366**), **no hace falta** repetir este paso: la propiedad ya está verificada.

**2) Registrar el número (obligatorio para pasar de Pendiente a Conectado)**

```bash
curl -X POST "https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}/register" \
  -H "Authorization: Bearer {TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"messaging_product":"whatsapp","pin":"123456"}'
```

Sustituye `123456` por el **PIN de 6 dígitos** real configurado en Meta para ese número.

Respuesta esperada: `{"success":true}`. Tras esto, el estado en el panel suele pasar a **Conectado** y los envíos por API dejan de responder **133010** (siempre que `PHONE_NUMBER_ID_*` y el token del `.env` coincidan con este número).

**Seguridad:** no compartas tokens en chats, issues ni capturas; rota el token si se expuso en un terminal o documento.

### 6.5 App Secret (firma del webhook)

1. **Configuración de la app** → **Básica** (App settings → Basic).
2. **Clave secreta de la aplicación (App Secret)** → mostrar y copiar.
3. En tu `.env`: **`APP_SECRET`** — se usa para validar el header `X-Hub-Signature-256` en `POST /webhook` cuando `REQUIRE_WEBHOOK_SIGNATURE=true`.

### 6.6 Webhook en Meta (cuando HTTPS y la app ya respondan)

1. **WhatsApp** → **Configuración** (Configuration).
2. **Webhook** → **Editar**.
3. **Callback URL:** `https://whatsapp.mali.pe/webhook`  
   Debe ser exactamente **`APP_BASE_URL` + `/webhook`** (sin barra final en `APP_BASE_URL`). **Ruta singular:** `/webhook`.
4. **Verify token:** una cadena secreta que inventas tú; la misma en **`VERIFY_TOKEN`** del `.env`.
5. Tras guardar, Meta envía un **GET** de verificación; la app debe responder **200** con el `hub.challenge` si el token coincide (ver sección 11).
6. **Campos suscritos:** como mínimo `messages`; si aplica, `message_template_status_update`.

### 6.7 WhatsApp Manager (plantillas)

Desde el ecosistema Meta / Business: **WhatsApp Manager** — crear plantillas, enviar a revisión y esperar estado **Aprobada**. Sin plantilla aprobada no hay envíos masivos “en frío” con texto libre.

### 6.8 Orden mínimo resumido

1. Business / acceso al portafolio correcto.  
2. App en Developers + producto WhatsApp.  
3. Phone number ID + token + (opcional) WABA.  
4. **Registrar el número** con `POST /{phone-number-id}/register` y el PIN de dos pasos (sección 6.4) si el estado sigue Pendiente o ves **133010** al enviar.  
5. App Secret.  
6. HTTPS público funcionando → Webhook + Verify token.  
7. Plantillas aprobadas → panel **Sincronizar plantillas**.

---

## 7. Credenciales, variables `.env` y mapa Meta → entorno

Completa un archivo **`.env`** en la **raíz del proyecto** (en el servidor, junto al `docker-compose.yml`; no lo subas a Git). Puedes partir de `.env.example`.

### Mapa rápido “dónde lo copio en Meta”

| Variable `.env` | Origen típico en Meta / infra |
|-----------------|--------------------------------|
| `APP_BASE_URL` | URL pública HTTPS **sin** barra final (`https://whatsapp.mali.pe`) |
| `BASE_PATH` | Vacío si la app está en la raíz del dominio |
| `VERIFY_TOKEN` | Texto que **tú defines** en Webhook → Verify token (mismo valor) |
| `APP_SECRET` | App → Configuración → Básica → App Secret |
| `WHATSAPP_TOKEN` / `WHATSAPP_TOKEN_PAM` / `WHATSAPP_TOKEN_EDUCACION` | Token de la API (Graph) con permisos WhatsApp |
| `PHONE_NUMBER_ID` / `PHONE_NUMBER_ID_PAM` / `PHONE_NUMBER_ID_EDUCACION` | WhatsApp → API Setup → **Phone number ID** |
| `WABA_ID_PAM` / `WABA_ID_EDUCACION` | Opcional: ID de cuenta WhatsApp Business si la app no deduce el WABA |

### Tabla ampliada de variables

| Variable | Uso |
|----------|-----|
| `PORT` | Puerto interno del contenedor (p. ej. `3000`). |
| `NODE_ENV` | `production` en servidor. |
| `APP_BASE_URL` | URL pública HTTPS **sin** barra final. |
| `BASE_PATH` | Vacío (`BASE_PATH=`) si la app está en la raíz del host. |
| `REQUIRE_AUTH` | `true` en producción para login con correo `@mali.pe`. |
| `SESSION_SECRET` | Secreto para firmar la cookie de sesión (obligatorio si `REQUIRE_AUTH=true`). |
| `DEV_AREA` | Solo desarrollo sin auth: `pam` o `educacion`. |
| `VERIFY_TOKEN` | Igual que el **Verify token** del webhook en Meta. |
| `APP_SECRET` | Firma `X-Hub-Signature-256` del webhook. |
| `REQUIRE_WEBHOOK_SIGNATURE` | `true` en producción recomendado. |
| `WHATSAPP_TOKEN` | Respaldo si no usas sufijos por área. |
| `PHONE_NUMBER_ID` | Respaldo si no usas sufijos por área. |
| `WHATSAPP_TOKEN_PAM` / `WHATSAPP_TOKEN_EDUCACION` | Token por área (Comercial PAM / Educación). |
| `PHONE_NUMBER_ID_PAM` / `PHONE_NUMBER_ID_EDUCACION` | Phone number ID por área. |
| `WABA_ID_PAM` / `WABA_ID_EDUCACION` | Opcional si falla la detección automática del WABA. |
| `POSTGRES_*` / `DATABASE_URL` | Credenciales de PostgreSQL (compose usa servicio `postgres`). |

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

## 8. Seguridad en producción y antes de salir a producción

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

## 9. Despliegue: Docker

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

### Desarrollo local (hot reload)

```bash
docker compose -f docker-compose.dev.yml up --build
```

Panel en **`http://localhost:3000`** (puertos publicados; no usa la red NPM).

### Comprobar salud

- **Con puerto local** (dev): `curl -i http://localhost:3000/health` → `200` y `{"ok":true,"db":"up"}`.
- **En servidor** (HTTPS): `curl -sS "https://whatsapp.mali.pe/health"` (ajusta el dominio).

---

## 10. Despliegue: Nginx Proxy Manager

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

## 11. Webhook: configuración en Meta y pruebas con `curl`

### En Meta (resumen)

**WhatsApp** → **Configuration** → **Webhook**:

| Campo | Valor |
|-------|--------|
| Callback URL | `https://whatsapp.mali.pe/webhook` (= `APP_BASE_URL` + `/webhook`) |
| Verify token | Igual que `VERIFY_TOKEN` en `.env` |

Suscripciones mínimas recomendadas: `messages` y, si aplica, `message_template_status_update`.

- Meta envía **`GET /webhook`** con `hub.mode`, `hub.verify_token`, `hub.challenge`; la app responde **200** con el challenge si el token coincide.
- Con `REQUIRE_WEBHOOK_SIGNATURE=true`, los **`POST`** sin firma válida reciben **401**. La firma `X-Hub-Signature-256` se calcula sobre el **cuerpo JSON en bruto** del POST; la app debe usar ese mismo buffer (no `JSON.stringify` del objeto ya parseado).

**`VERIFY_TOKEN` con caracteres especiales (`+`, `=`, `#`, espacios):** en `.env` usa comillas dobles, p. ej. `VERIFY_TOKEN="abc+def="`. Al probar con `curl`, codifica con `-G` y `--data-urlencode` (si pegas el token en la URL “a mano”, el `+` puede convertirse en espacio y fallará la verificación).

### Por qué `curl -I` puede confundir

- **`curl -I https://…/webhook`** (solo cabeceras, método **HEAD**) **sin** query string **no** reproduce la verificación de Meta. La app puede responder **403** si faltan `hub.mode` / `hub.verify_token` correctos: eso significa “verificación fallida”, no necesariamente que el proxy esté mal.
- Las rutas **`/`** o rutas equivocadas como **`/webhooks`** (plural) pueden redirigir **302** al login si `REQUIRE_AUTH=true` — la ruta correcta del proyecto es **`/webhook`** (singular).

### Prueba manual (sustituye `TU_VERIFY_TOKEN`)

Recomendado si el token lleva `+` u otros caracteres reservados en URL:

```bash
curl -sS -G "https://whatsapp.mali.pe/webhook" \
  --data-urlencode "hub.mode=subscribe" \
  --data-urlencode "hub.verify_token=TU_VERIFY_TOKEN" \
  --data-urlencode "hub.challenge=prueba_ok_123"
```

Respuesta esperada: cuerpo de texto **`prueba_ok_123`** y HTTP **200**.

---

## 12. Configuración operativa (panel)

Validar operativamente:

- Token de acceso vigente.
- Phone Number ID correcto.
- WABA alineado con Meta (o `WABA_ID_*` en `.env` si hace falta).
- Verify token y App Secret coherentes con Meta y con `.env`.
- Versión de API coherente con el backend (`GRAPH_API_VERSION` en código).

**Checklist rápido:** `WHATSAPP_TOKEN_*`, `PHONE_NUMBER_ID_*`, y en el panel **Sincronizar plantillas** para cargar plantillas aprobadas antes de enviar campañas.

---

## 13. Rol master, áreas y credenciales (enfoque simple)

Pensado para **un único operador master** (tú). Herramientas opcionales en el panel; el script `scripts/create-user.js` y el **`.env`** siguen siendo válidos.

### Área activa y master

- **Área** (`pam` | `educacion`): filtra campañas, contactos e historial. Viene del usuario al login y se guarda en sesión.
- **Usuario master** (`is_master` en `users`): ve la barra lateral **Admin** (Usuarios, Credenciales Meta) y el **selector de área** en la barra superior (formulario “Cambiar” entre PAM y Educación). Al cambiar de área se actualizan sesión y fila del usuario master en BD para que no queden desalineados.

### Usuarios del panel

- **CRUD mínimo (solo master):** rutas **`/admin/users`** — listado, alta, edición (área, master, contraseña opcional), eliminación (no puedes borrar tu propia sesión activa).
- Alternativa: **`node scripts/create-user.js`** como hasta ahora.

### Credenciales Meta: `app_settings` + `.env`

- La app lee primero **`app_settings`** (claves `meta.*`; área `global` para verify token y app secret; `pam` / `educacion` para token, phone number ID y WABA por área). Si un valor **no está en BD**, se usa **`process.env`** como hasta ahora.
- **Pantalla (solo master):** **`/admin/meta`** — guardar actualiza BD y refresca la caché en memoria; **dejar un campo vacío y guardar** borra el override en BD y vuelve a aplicar solo `.env`.
- Tras cambios solo en **`.env`**, recarga del contenedor según sección 9 (no hace falta entrar al panel).

### “CRUD de áreas” nuevas

- Siguen siendo **solo dos** áreas fijas en esquema (`pam`, `educacion`). No se añaden áreas dinámicas desde el panel.

---

## 14. Plantillas Meta: ejemplo invitación (Patronato / MALI)

WhatsApp **no** permite texto largo libre en frío: hace falta una **plantilla aprobada**. El texto fijo va en la plantilla; lo variable son `{{1}}`, `{{2}}`, … rellenados desde el panel.

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

## 15. Uso operativo por módulo

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

## 16. Errores frecuentes (API y plantillas)

| Código / síntoma | Causa probable | Qué revisar |
|------------------|----------------|-------------|
| **132000** | Parámetros distintos a los que espera la plantilla | Vuelve a sincronizar plantillas y rellena todos los campos del formulario |
| **132001** | Nombre o idioma de plantilla incorrecto | Nombre exacto y `languageCode` aprobado |
| **131030** | Número no permitido en modo prueba | Lista de números permitidos en Meta (sandbox) |
| **133010** `Account not registered` | Número no registrado en Cloud API (suele quedar **Pendiente**) | Completar **sección 6.4**: `POST /{phone-number-id}/register` con `messaging_product` + PIN de dos pasos; revisar Phone number ID en `.env` |
| **136024** (subcódigo 2388366) | «Número ya verificado» al pedir SMS | Normal si la propiedad ya está verificada: seguir directamente con **`/register`** |
| `Invalid webhook signature` | Firma no válida o secreto mal configurado | `APP_SECRET`, `REQUIRE_WEBHOOK_SIGNATURE` |
| No llegan estados | Webhook o red | Suscripción del webhook, URL HTTPS pública, firma |
| Muchos errores por límite | Ritmo alto | Reducir `batchSize`, aumentar `batchDelayMs` |

---

## 17. Procedimiento: sandbox → piloto → masivo

### Fase A — Sandbox

- [ ] Healthcheck OK (`/health` por HTTPS).
- [ ] Webhook verificado por Meta (GET con challenge).
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

## 18. Troubleshooting rápido

- **Plantilla**: nombre e idioma exactos; parámetros alineados con la plantilla en Meta.
- **Estados**: webhook suscrito, URL HTTPS correcta (`APP_BASE_URL` + `/webhook`).
- **Rendimiento**: lotes más pequeños y más delay entre lotes.

---

## 19. Go-live: lista bloqueante

- [ ] Secretos rotados y `.env` protegido.
- [ ] `REQUIRE_AUTH` y `SESSION_SECRET` activos; usuarios con correo `@mali.pe`.
- [ ] Firma de webhook obligatoria en producción.
- [ ] Plantilla aprobada y validada en piloto.
- [ ] Healthcheck y base de datos estables.
- [ ] Primera campaña piloto con trazabilidad en historial.

---

## 20. Mejoras posteriores (no bloqueantes)

- Cola de envíos con reintentos y backoff.
- Alertas y métricas (entrega/error por campaña).
- Pruebas automatizadas de rutas críticas.
- Cifrado en reposo para secretos en `app_settings` (opcional, si el riesgo lo justifica).
