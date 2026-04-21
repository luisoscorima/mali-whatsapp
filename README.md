# MALI WhatsApp MVP

Plataforma web para **operar WhatsApp Business (Cloud API)** en MALI: **varios números** (líneas por área: TI, PAM, Educación), campañas con plantillas aprobadas, gestión de contactos y **inbox unificado** con conversaciones en tiempo casi real. Incluye **respuesta automática con IA** (bot) por área, con posibilidad de **pasar el hilo a un asesor humano** cuando haga falta.

## Características

- **Multi-área y multi-número:** TI (desarrollo), PAM y Educación operan como **líneas de WhatsApp distintas**: cada área tiene su **token** y **Phone Number ID** (`WHATSAPP_TOKEN_`* / `PHONE_NUMBER_ID_`* en `.env`, o credenciales guardadas en **Admin → Meta** con prioridad sobre el entorno). Los envíos y la bandeja usan siempre la línea del área del usuario. Un mismo webhook de Meta puede alimentar las tres líneas: el sistema **resuelve el área** según `metadata.phone_number_id`, el **WABA** (`WABA_ID_TI`, `WABA_ID_PAM`, `WABA_ID_EDUCACION` si hace falta) o, en casos límite, el teléfono del remitente ya vinculado en contactos/conversaciones/campañas.
- **Integración Meta:** envío de plantillas, recepción de mensajes y medios, webhook de estados (`sent` / `delivered` / `read` / `failed`).
- **Segmentación:** contactos con etiquetas de segmento; campañas dirigidas a segmentos concretos.
- **Panel unificado:** rutas reales (sin “tabs” por hash), vista tipo inbox para conversaciones y KPIs de campañas.
- **Seguridad operativa:** sesiones para el panel, verificación opcional de firma del webhook (`X-Hub-Signature-256`), usuarios por dominio `@mali.pe`.
- **IA asistida (Groq):** respuestas en sesión de 24 h cuando la conversación está en modo **Bot**; el master puede activar o desactivar el bot por área desde Ajustes.

## Funcionalidades


| Ámbito              | Qué incluye                                                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Campañas**        | Creación con plantillas sincronizadas desde Meta; parámetros dinámicos según la plantilla; seguimiento de envíos y embudo de estados.                                                                           |
| **Contactos**       | Alta manual, edición, filtros; **importación masiva CSV** con ejemplo descargable.                                                                                                                              |
| **Segmentos**       | Definición y mantenimiento de segmentos para filtrar audiencias.                                                                                                                                                |
| **Conversaciones**  | Lista e hilo por contacto; respuesta del asesor en ventana de 24 h; adjuntos según soporte del flujo; exportación de historial donde aplique.                                                                   |
| **Plantillas**      | Sincronización desde Graph API; formulario adaptado a cabeceras (imagen/video/documento) y textos con `{{1}}`, etc.                                                                                             |
| **Ajustes / Admin** | Credenciales Meta **por número/área** (token + Phone Number ID; alternativa o complemento a `.env`); configuración de **IA por área** (`prompt`, palabra clave de transferencia, activación global por master). |
| **API / sistema**   | `GET /health`, `GET /api/dashboard`, webhook `GET/POST /webhook` para Meta.                                                                                                                                     |


## IA y bots (respuesta automática)

- **Motor:** API compatible OpenAI de **Groq** (`llama-3.1-8b-instant`), vía `GROQ_API_KEY` en `.env`. Sin clave, los mensajes entrantes se guardan pero **no** se genera respuesta automática.
- **Modo por conversación:** estados `bot` (responde la IA si está habilitada en el área) y `human` (solo el equipo desde el panel). El usuario master puede **activar o desactivar el bot para todo un área**; al activar, las conversaciones pasan a modo bot; al desactivar, a asesor.
- **Contexto:** se envían los últimos turnos del hilo para mantener coherencia en la sesión.
- **Transferencia a humano:** si el modelo incluye la **palabra clave configurable** (por defecto `[TRANSFERIR]`), el sistema notifica al usuario y pasa la conversación a **Asesor**. Si la IA falla o no está disponible, la conversación puede pasar automáticamente a humano con un mensaje de cortesía.
- **Edición del comportamiento:** usuarios con permiso pueden ajustar **prompt** y **palabra clave** por área; solo el master cambia el interruptor global de activación.

## Beneficios

- **Operación centralizada:** un solo panel para campañas, contactos y atención, alineado a procesos de MALI, con **varios números oficiales** (uno por área) sin mezclar audiencias ni credenciales.
- **Menos fricción con Meta:** plantillas y parámetros alineados a lo aprobado en WhatsApp Manager; menos errores `132000` / `132001` por desajustes manuales.
- **Escalado del primer contacto:** el bot responde 24/7 dentro de la ventana de sesión, con reglas claras de **escalamiento a persona**.
- **Trazabilidad:** logs de campaña, estados de entrega/lectura vía webhook y mensajes etiquetados como generados por IA cuando corresponde.
- **Despliegue reproducible:** Docker Compose, migraciones idempotentes al arrancar y documentación de producción en el repositorio.

## Estructura

```txt
mali-whatsapp-mvp/
  app/
    src/
      routes/          # Routers por función (auth, inbox views, campañas, conversaciones, webhook…)
      db/migrations.js # Esquema PostgreSQL idempotente (fuente de verdad al arrancar)
    public/
    views/
    server.js
  db/
    init.sql         # Nota: el esquema real lo aplica migrations.js al iniciar la app
  docker-compose.yml
  README.md
```

## Estado actual del demo

- `app/` es la aplicación principal.
- Al **arrancar** el servidor se ejecutan las migraciones PostgreSQL (`app/src/db/migrations.js`): en una BD vacía se crean tablas e índices; no hace falta importar `db/init.sql` en Docker.
- Importación masiva de contactos por **CSV** desde el panel (sección Contactos); ejemplo descargable en `/contacts/sample.csv`.
- La capa de vistas usa un único patrón basado en `conversations.ejs`: `wa-rail` + `inbox-sidebar` + `inbox-main`.
- Se eliminó el dashboard multipestaña (`hash tabs`) y ahora la navegación es por rutas reales.

## Primer arranque

1. Copia variables en el proyecto raíz:

```bash
cp .env.example .env
```

1. Completa en `.env`:

- `WHATSAPP_TOKEN_TI` / `PHONE_NUMBER_ID_TI`, `WHATSAPP_TOKEN_PAM` / `PHONE_NUMBER_ID_PAM` y `WHATSAPP_TOKEN_EDUCACION` / `PHONE_NUMBER_ID_EDUCACION` (o `WHATSAPP_TOKEN` / `PHONE_NUMBER_ID` como respaldo genérico)
- `VERIFY_TOKEN`
- `APP_SECRET` (obligatorio en produccion)
- `REQUIRE_WEBHOOK_SIGNATURE=true` en produccion
- `REQUIRE_AUTH=true` + `SESSION_SECRET` (login con correo **@mali.pe**; ver usuarios abajo)
- Opcional: `MASTER_INITIAL_PASSWORD` para crear en el **primer arranque** el usuario master `loscorima@mali.pe` (o `MASTER_USER_EMAIL` si quieres otro correo); luego quita la variable del `.env`
- `DEFAULT_TEMPLATE_NAME` y `DEFAULT_TEMPLATE_LANGUAGE` (ej. `hello_world` + `en_US` para cuentas de prueba)
- `TEMPLATES_WITHOUT_COMPONENTS` (ej. `hello_world`)
- `GROQ_API_KEY` (opcional pero necesaria para **respuesta automática con IA** en conversaciones en modo bot)
- credenciales de PostgreSQL

1. Levanta entorno local con Docker (modo deploy):

```bash
docker compose up -d --build
```

1. Usuarios del panel (correos **@mali.pe**; áreas **TI (dev)** `ti`, **PAM** `pam`, **Educación** `educacion`):

Las dependencias Node se instalan **solo al construir la imagen Docker** (`Dockerfile` + `npm install` dentro del contenedor). No hace falta ejecutar `npm` en tu sistema operativo.

- **Usuario master inicial:** si en `.env` defines `MASTER_INITIAL_PASSWORD` (y opcionalmente `MASTER_USER_EMAIL`, por defecto `loscorima@mali.pe`), al arrancar el contenedor se crea **una sola vez** ese usuario con área `ti` y rol master. Entra al panel, cambia la contraseña si quieres y **elimina `MASTER_INITIAL_PASSWORD`** del entorno.
- **Más usuarios** (desde el host, contra el contenedor `app`):

```bash
docker compose exec app sh -c 'cd /usr/src/app && node scripts/create-user.js "otro@mali.pe" "tu_clave" educacion'
docker compose exec app sh -c 'cd /usr/src/app && node scripts/create-user.js "otro@mali.pe" "tu_clave" pam master'
```

Tercer argumento: `ti`, `pam` o `educacion`. El último argumento opcional `master` marca usuario master (insignia en el panel). Cada usuario normal solo ve datos de su área; los envíos usan `WHATSAPP_TOKEN_*` / `PHONE_NUMBER_ID_*` de esa área.

1. Abre el panel:

```txt
http://localhost:3000
```

## Modo desarrollo (hot reload)

Usa el compose de desarrollo para cambios en vivo:

```bash
docker compose -f docker-compose.dev.yml up --build
```

Si aparece `Cannot find module` tras añadir dependencias en `package.json`, el volumen de `node_modules` del contenedor puede estar desactualizado: `docker compose -f docker-compose.dev.yml build --no-cache app`, luego `docker compose -f docker-compose.dev.yml run --rm app npm install`, y vuelve a levantar el compose (o revisa el comentario en `docker-compose.dev.yml`).

## Rutas principales del panel

- `GET /` redirección a `GET /campaigns`
- `GET /conversations` conversaciones (lista + hilo)
- `GET /campaigns` campañas (lista)
- `GET /campaigns/new` nueva campaña
- `GET /campaigns/:id` detalle de campaña
- `GET /contacts` contactos (lista)
- `GET /contacts/new` añadir un contacto
- `GET /contacts/import` importación CSV / Excel
- `GET /contacts/:id` editar contacto
- `GET /segments` segmentos (lista)
- `GET /segments/new` añadir segmento
- `GET /segments/:id` editar segmento
- `GET /history` → redirección a `GET /campaigns` (compatibilidad)
- `GET /history/:id` → redirección a `GET /campaigns/:id` (compatibilidad)
- `GET /settings` ajustes

En **Campañas** (`GET /campaigns`) se muestran la lista de campañas y el **resumen global de envíos** (indicadores); el detalle de cada campaña es `GET /campaigns/:id`.

**Indicadores:** los cuatro KPI operativos en lista y detalle son **Total** (filas en `campaign_logs`), **Salida OK** (estados `sent`, `delivered` o `read`), **Error %** sobre el total y **Lectura %** (lecturas sobre Salida OK; si Salida OK es 0 se muestra —). En el detalle, **Embudo Meta (detalle)** es un desglose por estado y ratios opcionales solo para diagnóstico; no reemplaza los informes de la cuenta Meta.

## Endpoints útiles (API / sistema)

- `GET /health` salud de app + DB
- `GET /api/dashboard` datos agregados (compatibilidad para integraciones internas)
- `GET /webhook` verificación de webhook en Meta
- `POST /webhook` recepción de estados `sent/delivered/read/failed` y mensajes entrantes (incl. disparo de IA en modo bot si aplica)
- `PATCH /api/settings/ai/:area` configuración de IA por área (master o permiso de edición de prompt)
- `POST /api/settings/ai/:area/enable` activar/desactivar bot para todo el área (solo master)

## Plantillas desde Meta

El panel **sincroniza** las plantillas aprobadas desde la Graph API (cuenta de WhatsApp / WABA) con el botón **Sincronizar plantillas**. No hace falta escribir nombres ni idioma a mano: al elegir una plantilla, el formulario se adapta a su estructura (cabecera imagen/video/documento, textos `{{1}}`…, botones URL dinámicos).

El token de la app debe poder leer `message_templates` (permisos de negocio / WhatsApp). Si falla la resolución automática del WABA, define en `.env` opcionalmente `WABA_ID_TI`, `WABA_ID_PAM` y/o `WABA_ID_EDUCACION`.

Si la combinación nombre/idioma no existe en Meta, verás el error `132001`. Si los parámetros no coinciden con la plantilla, verás el error `132000`.

Si estás en sandbox y sale `131030`, agrega el número destino en la lista de destinatarios permitidos de Meta Developers.

## Guía de producción y operación

- `**[DESPLIEGUE_PRODUCCION_APP.md](DESPLIEGUE_PRODUCCION_APP.md)`** — arquitectura, Docker, Nginx, `.env`, roles, uso del panel, go-live
- `**[CONFIGURACION_META.md](CONFIGURACION_META.md)`** — Developers, Business Manager, webhooks, `subscribed_apps`, `curl` (números nuevos, SMS, register)

### Publicación (resumen)

El panel en producción vive en `**https://whatsapp.mali.pe**` (subdominio dedicado; sin subruta).

- **NPM:** proxy host `whatsapp.mali.pe` → contenedor `mali-whatsapp-app:3000` en la raíz (`/`), red Docker compartida con NPM.
- `**.env`:** `BASE_PATH=` (vacío), `APP_BASE_URL=https://whatsapp.mali.pe`
- **SSL:** Let’s Encrypt en el mismo proxy host.
- **Webhook Meta:** `https://whatsapp.mali.pe/webhook`

## Notas del MVP

- La **IA** depende de `GROQ_API_KEY` y de que el área tenga el bot habilitado en Ajustes; las conversaciones deben estar en estado `bot` para respuestas automáticas.
- Usa plantillas aprobadas de WhatsApp.
- El idioma debe coincidir con una traducción existente de la plantilla en WhatsApp Manager.
- En cuentas de prueba de Meta, solo se puede enviar a números agregados en la "lista de destinatarios permitidos".
- El campo `imageUrl` asume una imagen pública.
- Los estados `sent`, `delivered`, `read`, `failed` se actualizan desde `/webhook`.
- Para una siguiente fase conviene agregar cola con Redis.

