# MALI WhatsApp

Plataforma web de **WhatsApp Business (Cloud API)** para el Museo de Arte de Lima: **varios números oficiales** por área, campañas con plantillas aprobadas, gestión de contactos y **inbox unificado** con conversaciones en tiempo casi real. Incluye **respuesta automática con IA** por área, **asignación a asesores**, horario de atención, bitácora y reportería operativa.

En producción: **[https://whatsapp.mali.pe](https://whatsapp.mali.pe)**.

## Características

- **Multi-área y multi-número:** TI, PAM, Patronato, Educación, Educación CA y Educación EP operan como **líneas distintas**. Cada área tiene su token y Phone Number ID (`WHATSAPP_TOKEN_*` / `PHONE_NUMBER_ID_*` en `.env`, o credenciales en **Admin → Meta**, con prioridad sobre el entorno). Un mismo webhook de Meta alimenta todas las líneas: el sistema **resuelve el área** según `metadata.phone_number_id`, el WABA (`WABA_ID_*`) o, en casos límite, el teléfono ya vinculado.
- **CRM canónico (PAM):** `contacts` es la fuente de verdad de personas (phone, email, `opt_in` / `opt_in_email`). MALI ONE sincroniza membresías vía `POST /api/crm/sync` y consulta audiencia email en `GET /api/crm/audience`. Contrato: [docs/CRM-API.md](docs/CRM-API.md).
- **Integración Meta:** envío de plantillas, recepción de mensajes y medios, estados de entrega (`sent` / `delivered` / `read` / `failed`) y estado de plantillas (`message_template_status_update`).
- **Campañas en cola:** envíos masivos con **BullMQ + Redis** (inmediato o programado), reintentos automáticos y manuales, KPIs (fallidos, respondieron, costo WABA).
- **Inbox operativo:** filtros por asignado / sin asignar, asignación a asesores, envío de plantillas desde el hilo, bot ↔ humano, fuera de horario y descarga de medios.
- **Segmentación y atributos:** contactos con segmentos; definiciones de atributos por área; importación CSV/Excel; campañas con exclusiones y variables por contacto.
- **Seguridad y gobernanza:** Google OAuth `@mali.pe` + JWT, permisos por módulo, bitácora de auditoría con retención configurable, usuarios y áreas desde Admin.
- **IA asistida (Groq):** respuestas en ventana de 24 h en modo **Bot**; el master activa o desactiva el bot por área desde Ajustes.
- **Leads CTWA:** detección de anuncios Click-to-WhatsApp (`referral`) → Facebook/Instagram, globo en el chat y listado en `/anuncios`.

## Funcionalidades

| Ámbito | Qué incluye |
|--------|-------------|
| **Conversaciones** | Inbox master–detail; búsqueda; chips de segmento y anuncio; asignación; envío de plantilla; marcado no leído; adjuntos y descarga; exportación; bot / asesor. |
| **Campañas** | Plantillas sync o creadas en la app; parámetros por contacto; preview con exclusiones; cola Redis; programación; fallidos + CSV; respondieron (7 días); reintento auto/manual; costo WABA. |
| **Contactos** | Alta, edición, filtros (número, nombre, email, atributos); importación masiva CSV/Excel; segmentos; ejemplo en `/contacts/sample.xlsx`. CRM canónico para PAM (sync desde MALI ONE). |
| **CRM interno** | `POST /api/crm/sync`, `GET /api/crm/audience` con `CRM_SERVICE_TOKEN` para mailing en MALI ONE. |
| **Segmentos** | Definición y mantenimiento de audiencias. |
| **Atributos** | Definiciones por área (`/attributes`) para formularios, importación y variables `{{n}}` en campañas. |
| **Plantillas** | Sync desde Graph; alta vía app (`/templates/new`); estados PENDING/APPROVED/REJECTED; preview en vivo. |
| **Anuncios Meta** | Listado CTWA en `/anuncios` por `source_id`; leads; nombre editable. |
| **Ajustes** | Integración; IA por área; fuera de horario; bitácora; reportería. |
| **Admin** | Usuarios y permisos; áreas; credenciales Meta; auditoría global (solo master). |
| **API / sistema** | `GET /health`, webhook `GET/POST /webhook`, APIs de campañas, contactos, conversaciones y settings. |

## IA y bots

- **Motor:** API compatible OpenAI de **Groq** (`llama-3.1-8b-instant`), vía `GROQ_API_KEY`. Sin clave, los mensajes se guardan pero no hay respuesta automática.
- **Modo por conversación:** `bot` (IA si el área tiene el bot habilitado) y `human` (solo el equipo). El master activa o desactiva el bot para todo un área.
- **Contexto:** últimos turnos del hilo para coherencia en la sesión.
- **Transferencia a humano:** palabra clave configurable (por defecto `[TRANSFERIR]`); si la IA falla, puede pasar a asesor con mensaje de cortesía.
- **Fuera de horario:** mensaje automático configurable por área cuando no hay atención humana.

## Stack

| Capa | Tecnología |
|------|------------|
| API | NestJS + Prisma + BullMQ |
| Web | React + Vite + Tailwind (SPA) |
| Datos | PostgreSQL |
| Colas | Redis |
| Auth | Google OAuth `@mali.pe` + JWT |

```txt
mali-whatsapp-mvp/
  api/                 # NestJS + Prisma + BullMQ
  web/                 # React + Vite + Tailwind
  docker-compose.yml   # Producción: api + web + postgres + redis
  scripts/             # deploy-production.sh, backup-postgres.sh
  ARRANQUE_V2.md
  DESPLIEGUE_V2.md
```

Arranque local: [ARRANQUE_V2.md](ARRANQUE_V2.md). Producción: [DESPLIEGUE_V2.md](DESPLIEGUE_V2.md).

## Primer arranque

1. Copia variables en la raíz del proyecto:

```bash
cp .env.example .env
```

2. Completa en `.env` (detalle en `.env.example`):

- Tokens y Phone Number ID por área (`_TI`, `_PAM`, `_PATRONATO`, `_EDUCACION`, `_EDUCACION_CA`, `_EDUCACION_EP`), o respaldo genérico
- `VERIFY_TOKEN`, `APP_SECRET` (obligatorio en producción)
- `REQUIRE_WEBHOOK_SIGNATURE=true` en producción
- `REQUIRE_AUTH=true` + secretos JWT / sesión
- `BOOTSTRAP_ADMIN_EMAIL` (acceso master vía Google)
- Opcional: `MASTER_INITIAL_PASSWORD` solo en el **primer arranque**; luego quítalo
- `GROQ_API_KEY` para respuesta automática
- PostgreSQL y, en compose, Redis
- `CRM_SERVICE_TOKEN` — sync/audiencia desde MALI ONE ([docs/CRM-API.md](docs/CRM-API.md))
- Opcional campañas: `CAMPAIGN_AUTO_RETRY_DELAY_MINUTES`, `CAMPAIGN_MAX_RETRY_ATTEMPTS`, `CAMPAIGN_RESPONSE_WINDOW_DAYS`, `CAMPAIGN_COST_PER_MESSAGE_USD`

3. Levanta entorno local:

```bash
docker compose -f docker-compose.dev.yml up --build
```

4. **Usuarios:** login con Google (`@mali.pe`). El bootstrap admin tiene acceso master; el resto se aprovisiona en **Admin → Usuarios** con permisos por módulo.

5. Panel: `http://localhost:5173` (dev) o `https://whatsapp.mali.pe` (prod).

## Rutas principales del panel

- `GET /` → redirección a `GET /conversations`
- `GET /conversations` · `GET /conversations/:id` — inbox (lista + hilo)
- `GET /campaigns` · `/campaigns/new` · `/campaigns/:id` — campañas
- `GET /contacts` · `/contacts/new` · `/contacts/import` · `/contacts/:id`
- `GET /segments` · `/segments/new` · `/segments/:id`
- `GET /attributes` · `/attributes/new` · `/attributes/:id`
- `GET /templates` · `/templates/new` · `/templates/:id`
- `GET /anuncios` · `/anuncios/:id`
- `GET /settings` · `/settings/integracion` · `/settings/ia` · `/settings/fuera-de-horario` · `/settings/bitacora` · `/settings/reporteria`
- `GET /admin` · `/admin/users` · `/admin/areas` · `/admin/meta` · `/admin/audit-logs` (master)

**Indicadores de campaña:** Total, Salida OK, Error %, Lectura %; en detalle: Respondieron (7d), Envíos fallidos, Costo/inversión (sync WABA) y reintento. El embudo Meta es desglose por estado; no sustituye los informes de la cuenta Meta.

## Endpoints útiles

- `GET /health` — salud de app + DB
- `GET /webhook` / `POST /webhook` — verificación Meta; mensajes, estados, plantillas, IA en modo bot
- `POST /api/campaigns/recipients-preview` — vista previa de destinatarios
- `GET /api/campaigns/:id/failed-export` — CSV de fallidos
- `POST /api/campaigns/:id/retry-failed` — reintento manual
- `POST /api/campaigns/:id/sync-cost` — sincronizar costo WABA
- `GET /conversations/:conversationId/messages/:messageId/download` — media del hilo (auth)
- `POST /conversations/:id/mark-unread`
- `PATCH /api/settings/ai/:area` · `POST /api/settings/ai/:area/enable`
- `GET /api/templates/:id/definition`
- `POST /api/crm/sync` — upsert contacto desde MALI ONE (`X-Crm-Service-Token`)
- `GET /api/crm/audience` — audiencia email (opt-in) para mailing
- `GET /api/crm/contacts` — listado CRM completo para vista MALI ONE CRM PAM

## Plantillas desde Meta

- **Sincronizar:** desde el panel → `GET message_templates` del WABA. Solo **APPROVED** en el selector de envío.
- **Crear:** `/templates/new` envía a revisión (`PENDING`). Meta notifica con `message_template_status_update`.
- El formulario de campaña se adapta a cabeceras (media), textos `{{1}}`… y botones URL; cada variable puede ser fija o por contacto.

El token necesita `whatsapp_business_management`. Si falla la resolución del WABA, define `WABA_ID_*` por área.

Errores frecuentes: `132001` (plantilla/idioma), `132000` (parámetros), `131030` (sandbox: número no permitido).

En Meta Developers, suscribe el webhook a **`message_template_status_update`** además de mensajes y estados.

## CTWA (Click-to-WhatsApp)

1. Pauta CTWA en Meta Ads Manager.
2. Al llegar `referral` (o `context.referral`), la app registra el anuncio por `source_id`, infiere Facebook o Instagram y muestra headline/body en el hilo.
3. En **Anuncios** (`/anuncios`) aparecen IDs, creativo y leads; el nombre visible es editable.

La **inversión de la pauta** (spend Ads) no se muestra; el costo en detalle de campaña es el del **envío masivo de plantillas** (WABA).

## Guía de producción y operación

- **[DESPLIEGUE_PRODUCCION_APP.md](DESPLIEGUE_PRODUCCION_APP.md)** — arquitectura, Docker, Nginx, `.env`, roles, go-live
- **[CONFIGURACION_META.md](CONFIGURACION_META.md)** — Developers, Business Manager, webhooks, `subscribed_apps`
- **[Mejoras.md](Mejoras.md)** — observaciones de usuarios y estado de implementación
- **[ARRANQUE_V2.md](ARRANQUE_V2.md)** / **[DESPLIEGUE_V2.md](DESPLIEGUE_V2.md)** — arranque local y despliegue v2

### Publicación (resumen)

- **URL:** `https://whatsapp.mali.pe` (raíz del subdominio; sin subruta)
- **Proxy:** host → contenedor app en puerto `3000`
- **`.env`:** `BASE_PATH=` (vacío), `APP_BASE_URL=https://whatsapp.mali.pe`
- **Webhook Meta:** `https://whatsapp.mali.pe/webhook`

## Notas operativas

- La **IA** requiere `GROQ_API_KEY` y bot habilitado en el área; la conversación debe estar en modo `bot`.
- Los envíos masivos usan plantillas **aprobadas**; el idioma debe coincidir con una traducción existente en WhatsApp Manager.
- En cuentas de prueba de Meta solo se puede enviar a números permitidos.
- Estados `sent` / `delivered` / `read` / `failed` llegan por `/webhook`.
- Campañas grandes se procesan con **Redis/BullMQ** (cola de envío y reintentos).
- **SIGE** (matrícula / conversión por campaña) y spend de pauta Ads siguen en backlog; ver [Mejoras.md](Mejoras.md).
