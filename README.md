# MALI WhatsApp MVP

Plataforma web para **operar WhatsApp Business (Cloud API)** en MALI: **varios números** (líneas por área: TI, PAM, Educación), campañas con plantillas aprobadas, gestión de contactos y **inbox unificado** con conversaciones en tiempo casi real. Incluye **respuesta automática con IA** (bot) por área, con posibilidad de **pasar el hilo a un asesor humano** cuando haga falta.

## Características

- **Multi-área y multi-número:** TI (desarrollo), PAM y Educación operan como **líneas de WhatsApp distintas**: cada área tiene su **token** y **Phone Number ID** (`WHATSAPP_TOKEN_*` / `PHONE_NUMBER_ID_*` en `.env`, o credenciales guardadas en **Admin → Meta** con prioridad sobre el entorno). Los envíos y la bandeja usan siempre la línea del área del usuario. Un mismo webhook de Meta puede alimentar las tres líneas: el sistema **resuelve el área** según `metadata.phone_number_id`, el **WABA** (`WABA_ID_TI`, `WABA_ID_PAM`, `WABA_ID_EDUCACION` si hace falta) o, en casos límite, el teléfono del remitente ya vinculado en contactos/conversaciones/campañas.
- **Integración Meta:** envío de plantillas, recepción de mensajes y medios, webhook de estados (`sent` / `delivered` / `read` / `failed`) y de **estado de plantillas** (`message_template_status_update`).
- **Segmentación:** contactos con etiquetas de segmento; campañas dirigidas a segmentos con **exclusiones** (segmentos, IDs o listas guardadas).
- **Panel unificado:** rutas reales (sin “tabs” por hash), vista tipo inbox para conversaciones y KPIs de campañas ampliados (fallidos, respondieron, costo, reintentos).
- **Seguridad operativa:** sesiones para el panel, verificación opcional de firma del webhook (`X-Hub-Signature-256`), usuarios por dominio `@mali.pe`.
- **IA asistida (Groq):** respuestas en sesión de 24 h cuando la conversación está en modo **Bot**; el master puede activar o desactivar el bot por área desde Ajustes.
- **Leads CTWA:** detección automática de anuncios Click-to-WhatsApp (`referral` en el mensaje, también en `context.referral`) → plataforma Facebook/Instagram, globo en el chat y listado en `/anuncios`.

## Funcionalidades

| Ámbito | Qué incluye |
|--------|-------------|
| **Campañas** | Plantillas sincronizadas o **creadas desde la app** (envío a revisión Meta); parámetros **por contacto** (nombre, atributos `sede`/`monto`/`fecha_pago`, etc.); preview de destinatarios con exclusiones; **lista de fallidos** + export CSV; KPI **respondieron (7 días)** con lista de teléfonos; **reintento** automático (~10 min) y manual; **costo/inversión** del envío (WABA o estimado). |
| **Contactos** | Alta manual, edición, filtros por **número, nombre y atributos**; **importación masiva CSV/Excel** (columnas extra → atributos); ejemplo en `/contacts/sample.csv`. |
| **Segmentos** | Definición y mantenimiento de segmentos para filtrar audiencias. |
| **Exclusiones en campaña** | Segmentos a excluir en nueva campaña; destinatarios puntuales desmarcando en el paso 2. |
| **Conversaciones** | Lista e hilo; búsqueda por texto, nombre o número; chips de **segmento y anuncio Meta**; globo con origen FB/IG y texto del anuncio; **descarga** de imágenes/documentos del hilo; marcado no leído; respuesta del asesor en ventana de 24 h; adjuntos y exportación. |
| **Plantillas** | Sync desde Graph; **alta vía API** (`/templates/new`); listado de estados PENDING/APPROVED/REJECTED; formulario de campaña adaptado a cabeceras y `{{n}}`. |
| **Anuncios Meta** | Listado automático en `/anuncios` por `source_id`; headline, body, URL; leads por anuncio; nombre editable (API de Ads más adelante). |
| **Ajustes / Admin** | Credenciales Meta por área; configuración de **IA por área** (master). |
| **API / sistema** | `GET /health`, `GET /api/dashboard`, webhook `GET/POST /webhook`, APIs de campaña (fallidos, reintento, costo). |

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
- **Trazabilidad:** logs de campaña, estados de entrega/lectura vía webhook, reintentos clasificados, costo de envío y mensajes etiquetados como generados por IA cuando corresponde.
- **Cobranza y audiencia:** mensajes personalizados por contacto y exclusiones operativas sin salir del panel.
- **Despliegue reproducible:** Docker Compose, migraciones idempotentes al arrancar y documentación de producción en el repositorio.

## Estructura

```txt
mali-whatsapp-mvp/
  app/
    src/
      routes/          # auth, inbox, campañas, contactos, anuncios Meta, plantillas, webhook…
      services/        # envío campaña, reintento, costo, respondientes, metaCtwaAds, atributos…
      db/migrations.js # Esquema PostgreSQL idempotente (fuente de verdad al arrancar)
    public/
    views/
    server.js
  db/
    init.sql         # Nota: el esquema real lo aplica migrations.js al iniciar la app
  docker-compose.yml
  Mejoras.md         # Seguimiento observaciones usuarios ↔ implementación
  README.md
```

## Estado actual del demo

- `app/` es la aplicación principal.
- Al **arrancar** el servidor se ejecutan las migraciones PostgreSQL (`app/src/db/migrations.js`): en una BD vacía se crean tablas e índices; no hace falta importar `db/init.sql` en Docker.
- Importación masiva de contactos por **CSV/Excel**; columnas adicionales (p. ej. `sede`, `monto`, `fecha_pago`) se guardan como **atributos** para campañas personalizadas.
- En **Conversaciones**, búsqueda por hilo, nombre o número; descarga de imágenes del hilo; globo de anuncio FB/IG en mensajes con `referral`; segmentos y enlace al anuncio en cabecera.
- En **Campañas**, detalle con fallidos, respondieron (7d), costo WABA, reintento y exclusiones (segmentos, IDs, listas).
- La capa de vistas usa `wa-rail` + `inbox-sidebar` + `inbox-main`.
- Navegación por rutas reales (sin dashboard multipestaña por hash).

Detalle de requisitos y checklist: **[Mejoras.md](Mejoras.md)**.

## Primer arranque

1. Copia variables en el proyecto raíz:

```bash
cp .env.example .env
```

2. Completa en `.env`:

- `WHATSAPP_TOKEN_TI` / `PHONE_NUMBER_ID_TI`, `WHATSAPP_TOKEN_PAM` / `PHONE_NUMBER_ID_PAM` y `WHATSAPP_TOKEN_EDUCACION` / `PHONE_NUMBER_ID_EDUCACION` (o `WHATSAPP_TOKEN` / `PHONE_NUMBER_ID` como respaldo genérico)
- `VERIFY_TOKEN`
- `APP_SECRET` (obligatorio en produccion)
- `REQUIRE_WEBHOOK_SIGNATURE=true` en produccion
- `REQUIRE_AUTH=true` + `SESSION_SECRET` (login con correo **@mali.pe**; ver usuarios abajo)
- Opcional: `MASTER_INITIAL_PASSWORD` para crear en el **primer arranque** el usuario master `loscorima@mali.pe` (o `MASTER_USER_EMAIL`); luego quita la variable del `.env`
- `DEFAULT_TEMPLATE_NAME` y `DEFAULT_TEMPLATE_LANGUAGE` (ej. `hello_world` + `en_US` para cuentas de prueba)
- `TEMPLATES_WITHOUT_COMPONENTS` (ej. `hello_world`)
- `GROQ_API_KEY` (opcional pero necesaria para **respuesta automática con IA** en conversaciones en modo bot)
- credenciales de PostgreSQL
- Opcional campañas: `CAMPAIGN_AUTO_RETRY_DELAY_MINUTES` (default 10), `CAMPAIGN_MAX_RETRY_ATTEMPTS`, `CAMPAIGN_MAX_MANUAL_RETRIES`, `CAMPAIGN_RESPONSE_WINDOW_DAYS` (default 7), `CAMPAIGN_COST_PER_MESSAGE_USD` (fallback si Meta no devuelve costo)

3. Levanta entorno local con Docker (modo deploy):

```bash
docker compose up -d --build
```

4. Usuarios del panel (correos **@mali.pe**; áreas **TI (dev)** `ti`, **PAM** `pam`, **Educación** `educacion`):

Las dependencias Node se instalan **solo al construir la imagen Docker** (`Dockerfile` + `npm install` dentro del contenedor). No hace falta ejecutar `npm` en tu sistema operativo.

- **Usuario master inicial:** si en `.env` defines `MASTER_INITIAL_PASSWORD` (y opcionalmente `MASTER_USER_EMAIL`, por defecto `loscorima@mali.pe`), al arrancar el contenedor se crea **una sola vez** ese usuario con área `ti` y rol master. Entra al panel, cambia la contraseña si quieres y **elimina `MASTER_INITIAL_PASSWORD`** del entorno.
- **Más usuarios** (desde el host, contra el contenedor `app`):

```bash
docker compose exec app sh -c 'cd /usr/src/app && node scripts/create-user.js "otro@mali.pe" "tu_clave" educacion'
docker compose exec app sh -c 'cd /usr/src/app && node scripts/create-user.js "otro@mali.pe" "tu_clave" pam master'
```

Tercer argumento: `ti`, `pam` o `educacion`. El último argumento opcional `master` marca usuario master (insignia en el panel). Cada usuario normal solo ve datos de su área; los envíos usan `WHATSAPP_TOKEN_*` / `PHONE_NUMBER_ID_*` de esa área.

5. Abre el panel:

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
- `GET /conversations/:id` detalle de conversación (también resuelve chats vacíos desde resultados de búsqueda de contactos)
- `GET /campaigns` campañas (lista)
- `GET /campaigns/new` nueva campaña (exclusiones, variables por contacto)
- `GET /campaigns/:id` detalle de campaña (fallidos, respondieron, costo, reintento)
- `GET /contacts` contactos (lista; filtro por atributos)
- `GET /contacts/new` añadir un contacto
- `GET /contacts/import` importación CSV / Excel
- `GET /contacts/:id` editar contacto (incl. atributos)
- `GET /segments` segmentos (lista)
- `GET /segments/new` añadir segmento
- `GET /segments/:id` editar segmento
- `GET /anuncios` anuncios Click-to-WhatsApp (leads desde Meta Ads)
- `GET /anuncios/:id` detalle de anuncio, leads y nombre editable
- `GET /templates` plantillas (estados de revisión)
- `GET /templates/new` crear plantilla y enviar a Meta
- `GET /history` → redirección a `GET /campaigns` (compatibilidad)
- `GET /history/:id` → redirección a `GET /campaigns/:id` (compatibilidad)
- `GET /settings` ajustes

En **Campañas** (`GET /campaigns`) se muestran la lista de campañas y el **resumen global de envíos** (indicadores); el detalle de cada campaña es `GET /campaigns/:id`.

**Indicadores:** los cuatro KPI operativos en lista y detalle son **Total** (filas en `campaign_logs`), **Salida OK** (estados `sent`, `delivered` o `read`), **Error %** sobre el total y **Lectura %** (lecturas sobre Salida OK; si Salida OK es 0 se muestra —). En el detalle: **Respondieron (7d)**, **Envíos fallidos**, **Costo/inversión** (sync WABA) y acciones de **reintento**. El **Embudo Meta (detalle)** es desglose por estado; no reemplaza informes de la cuenta Meta.

## Endpoints útiles (API / sistema)

- `GET /health` salud de app + DB
- `GET /api/dashboard` datos agregados (compatibilidad para integraciones internas)
- `GET /webhook` verificación de webhook en Meta
- `POST /webhook` estados de mensajes, mensajes entrantes (IA en modo bot), **actualización de estado de plantillas**
- `POST /api/campaigns/recipients-preview` vista previa de destinatarios (con exclusiones)
- `GET /api/campaigns/:id/failed-export` export CSV de envíos fallidos
- `POST /api/campaigns/:id/retry-failed` reintento manual de fallidos
- `POST /api/campaigns/:id/sync-cost` sincronizar costo WABA de la campaña
- `GET /conversations/:conversationId/messages/:messageId/download` descargar media del hilo (auth)
- `POST /conversations/:id/mark-unread` marcar conversación como no leída
- `PATCH /api/settings/ai/:area` configuración de IA por área (master o permiso de edición de prompt)
- `POST /api/settings/ai/:area/enable` activar/desactivar bot para todo el área (solo master)
- `GET /api/templates/:id/definition` definición de plantilla para el formulario de campaña

## Plantillas desde Meta

- **Sincronizar:** botón **Sincronizar plantillas** en nueva campaña o flujo de sync → `GET message_templates` del WABA. Solo las **APPROVED** aparecen en el selector de envío.
- **Crear:** `GET /templates/new` → `POST /templates/create` envía la plantilla a revisión (`PENDING`). Meta notifica por webhook `message_template_status_update`; al aprobarse, aparece tras sync en campañas.
- El formulario de campaña se adapta a cabeceras (imagen/video/documento), textos `{{1}}`… y botones URL; cada variable puede ser **valor fijo** o **por contacto** (nombre, teléfono, atributos).

El token debe poder leer/escribir plantillas (`whatsapp_business_management`). Si falla la resolución del WABA, define `WABA_ID_TI`, `WABA_ID_PAM` y/o `WABA_ID_EDUCACION`.

Errores frecuentes: `132001` (plantilla/idioma inexistente), `132000` (parámetros incorrectos), `131030` en sandbox (número no permitido).

En Meta Developers, suscribe el webhook al campo **`message_template_status_update`** además de mensajes y estados.

## CTWA (anuncios Click-to-WhatsApp)

1. Crea la pauta en Meta Ads Manager (CTWA).
2. Cuando el usuario escribe con `referral` (o `context.referral`) en el webhook, la app registra el anuncio por `source_id`, infiere **Facebook** o **Instagram** desde `source_url`, y muestra **headline** y **body** en un globo pequeño en el hilo.
3. En **Anuncios** (`/anuncios`) ves la lista de IDs de anuncio, datos del creativo y los teléfonos/nombres que llegaron desde cada uno. Puedes editar un **nombre visible** (más adelante se sincronizará con la API de Meta Ads).

La **inversión de la pauta** (spend en Ads Manager) **no** se muestra en v1; el costo en detalle de campaña es el del **envío masivo de plantillas** en la app.

## Guía de producción y operación

- **[DESPLIEGUE_PRODUCCION_APP.md](DESPLIEGUE_PRODUCCION_APP.md)** — arquitectura, Docker, Nginx, `.env`, roles, uso del panel, go-live
- **[CONFIGURACION_META.md](CONFIGURACION_META.md)** — Developers, Business Manager, webhooks, `subscribed_apps`, `curl` (números nuevos, SMS, register)
- **[Mejoras.md](Mejoras.md)** — observaciones de usuarios, decisiones de producto y estado de implementación

### Publicación (resumen)

El panel en producción vive en **`https://whatsapp.mali.pe`** (subdominio dedicado; sin subruta).

- **NPM:** proxy host `whatsapp.mali.pe` → contenedor `mali-whatsapp-app:3000` en la raíz (`/`), red Docker compartida con NPM.
- **`.env`:** `BASE_PATH=` (vacío), `APP_BASE_URL=https://whatsapp.mali.pe`
- **SSL:** Let’s Encrypt en el mismo proxy host.
- **Webhook Meta:** `https://whatsapp.mali.pe/webhook`

## Notas del MVP

- La **IA** depende de `GROQ_API_KEY` y de que el área tenga el bot habilitado en Ajustes; las conversaciones deben estar en estado `bot` para respuestas automáticas.
- Usa plantillas **aprobadas** de WhatsApp para envíos masivos.
- El idioma debe coincidir con una traducción existente de la plantilla en WhatsApp Manager.
- En cuentas de prueba de Meta, solo se puede enviar a números en la lista de destinatarios permitidos.
- **SIGE** (matrícula / conversión por campaña) está planificado para una fase posterior; no forma parte del MVP actual.
- Los estados `sent`, `delivered`, `read`, `failed` se actualizan desde `/webhook`.
- Para una siguiente fase conviene valorar cola con Redis en envíos muy grandes.
