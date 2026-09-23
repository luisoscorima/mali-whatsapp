# CRM API — contrato interno (MALI ONE ↔ WhatsApp)

Fuente de verdad de **personas PAM y Educación**: `mali-whatsapp` (`contacts` por área). La captación multicanal de Educación vive en `contact_origins`.

MALI ONE es dueño del **producto** (membresías, pagos) y del **mailing** (SES). No mantiene una BD paralela de clientes.

## Autenticación

Header (preferido):

```http
X-Crm-Service-Token: <CRM_SERVICE_TOKEN>
```

Alternativa:

```http
Authorization: Bearer <CRM_SERVICE_TOKEN>
```

Misma clave en:

- WhatsApp: `CRM_SERVICE_TOKEN`
- MALI ONE: `WHATSAPP_CRM_SERVICE_TOKEN`
- Base URL WhatsApp API: `WHATSAPP_CRM_BASE_URL` (ej. `https://whatsapp.mali.pe` o `http://localhost:4000`)

## Endpoints

### `POST /api/crm/origins`

Ingestión de **evento de lead** (widget Educación, etc.). Match de persona: **phone → dni → email** (al menos uno). No escribe attrs de origen de campaña.

```json
{
  "area": "educacion_ep",
  "channel": "widget",
  "external_id": "educacion-lead-cuid",
  "source_key": "lead-form",
  "source_label": "Conversemos",
  "name": "Ana",
  "last_name": "Pérez",
  "phone": "51999888777",
  "email": "ana@example.com",
  "dni": "12345678",
  "opt_in": true,
  "opt_in_email": true,
  "payload": {
    "curso": "Historia del arte",
    "curso_url": "https://…",
    "fuente": "Web MALI Educación",
    "programa": "extensionprofesional"
  }
}
```

Respuesta: `{ contact_id, origin_id, created }`.

Ownership leads: [OWNERSHIP-LEADS.md](./OWNERSHIP-LEADS.md).

### `POST /api/crm/sync`

Upsert de contacto desde producto (`PamRegistration`).

```json
{
  "area": "pam",
  "name": "Ana",
  "last_name": "Pérez",
  "phone": "51999888777",
  "email": "ana@example.com",
  "dni": "12345678",
  "opt_in": true,
  "opt_in_email": true,
  "external_id": "clx...",
  "attributes": {
    "plan": "amigo",
    "frecuencia": "yearly",
    "mp_status": "approved",
    "expiry": "2027-07-21",
    "payment_id": "clx..."
  },
  "segment_slugs": ["amigo"]
}
```

- Teléfono: E.164 **sin** `+`.
- Match: `(area, phone)`.
- Columnas nativas: `name`, `last_name`, `email`, `dni` (opcional).
- Atributos se upsertan en `contact_attributes` (incl. `mali_one_id` si hay `external_id`).
- `segment_slugs`: asigna segmentos del contacto (p. ej. plan PAM → `amigo`, `circulo`, `comunidad`).

### `POST /api/crm/send-template`

Envía plantilla WhatsApp **APPROVED** (p. ej. bienvenida PAM desde MALI ONE).

```json
{
  "area": "pam",
  "phone": "51999888777",
  "template_name": "bienvenida_pam",
  "idempotency_key": "clx...",
  "body_params": ["Ana", "Amigo"],
  "header_media_url": "https://…/logo.png"
}
```

- Idempotente por `idempotency_key` (attr `pam_wa_template_sent` en contacto).
- Requiere contacto existente con ese teléfono en el área.
- Bienvenida PAM: `body_params` = `[Nombre, Plan]` (= contacto.name + attr CRM `plan`).
- `header_media_url` solo si la plantilla tiene cabecera IMAGE/VIDEO/DOCUMENT.
- Si Meta falla, la respuesta 400 incluye el mensaje de error de Graph (también en `campaign_logs.response`).

### `PATCH /api/crm/contacts/:id?area=pam`

Edición parcial de persona + attrs + `segment_slugs` (bidireccional desde MALI ONE).

### `GET /api/crm/contacts`

Listado CRM (contactos activos del área). Incluye `dni`, `email`, `segment_slugs`, `attributes`.

Query: `area`, `q`, `segment`, `has_email`, `opt_in_email`, `attr_key`, `attr_value`, `page`, `limit`.

### `GET /api/crm/education/contacts`

Listado unificado para CRM Educación en MALI ONE. `area=all` (por defecto) consulta **únicamente** `educacion`, `educacion_ca` y `educacion_ep`; también se puede indicar una de esas tres áreas. La búsqueda, los filtros, el total y la paginación se aplican sobre la unión de las tres áreas, ordenada por ID de contacto descendente. Admite `q`, `segment`, `has_email`, `opt_in_email`, `attr_key`, `attr_value`, `page` y `limit` (máximo 2000).

Respuesta: `{ ok: true, data: { area, items, total, page, limit, pages } }`. Cada item tiene `contact_id`, **`area`**, nombre, teléfono, email, DNI, consentimientos, `segment_slugs`, `attributes`, fechas, `assigned_user_id`, `assigned_user_label`, `lead_status_id` y `lead_status_label`. La columna **Número** de MALI ONE representa `area`, no el teléfono del contacto. Si una persona existe en dos áreas, hay dos filas y cada edición usa su `contact_id` y `area`. Los datos de persona y segmentos se editan vía `PATCH /api/crm/contacts/:id?area=…`; asesor y estado del ciclo actual vía el endpoint de gestión de Educación.

### `GET /api/crm/education/leads`

Entradas de captación de las mismas tres áreas, con una fila por `education_lead_entries.id`. Cada entrada puede apuntar a un origen y a un ciclo de lead; los regresos orgánicos tras 60 días generan una entrada nueva aunque permanezcan en la misma conversación. La comparación de historial se hace **dentro del número/área** de entrada (Educación, CA o EP). `area=all` es el valor por defecto; admite una de las tres áreas, además de `channel`, `q`, `view`, `unassigned`, `page` y `limit` (máximo 200). `view=recent` (por defecto) muestra **todas** las entradas de los últimos 60 días, incluidos duplicados y casos en curso. `view=new_number`, `duplicate`, `reassignable`, `conflict` e `in_progress` son subconjuntos del mismo periodo; `view=all` abre el historial. `unassigned=true` es un filtro adicional. Los contadores pueden superponerse.

Respuesta: `{ ok: true, data: { items, counts, total, page, limit, pages } }`. Cada entrada incluye clasificación (`new`, `duplicate`, `conflict` o `dismissed`), regla de asignación (`new_number`, `same_advisor`, `reassignable` o `conflict`), snapshot del asesor/estado/último contacto previos, asesor y estado del ciclo actual, `is_current_cycle`, contacto, fuente y fechas. Los ciclos históricos son de solo lectura. `counts` incluye `recent`, `new_number`, `duplicate`, `reassignable`, `conflict`, `in_progress`, `unassigned` y `eligible` (solo números sin historial, sin asesor y con ciclo actual).

Para `organic_wa`, el webhook registra una captación solo si no hay otro origen atribuible al contacto o conversación. El identificador `conversation:{id}` evita duplicados y `first_seen_at` toma la fecha del primer mensaje entrante. La migración `20260923200000_education_organic_origins` incorpora chats históricos de las tres áreas con el mismo criterio; se aplica al desplegar las migraciones, no al consultar el endpoint.

La ventana de **60 días exactos** compara cada nueva entrada con la última interacción entrante/captación previa del contacto en esa área; un mensaje saliente no amplía la ventana. Sin historial: número nuevo, elegible para reparto automático. Hasta 60 días: mismo asesor/ciclo, salvo conflicto. Más de 60 días: abre ciclo nuevo con el **asesor anterior conservado y pendiente de confirmación o cambio directo**; el estado del lead se reinicia. Nunca se borra una asignación existente como paso intermedio. `convertido`/`venta_exitosa`, o `no_interesado` dentro de 60 días, son las reglas iniciales de conflicto. El estado y la calificación de ciclos anteriores permanecen en el historial.

### Gestión de leads Educación

- `GET /api/crm/education/management-catalogs`: usuarios habilitados por área y estados activos por área.
- `PATCH /api/crm/education/contacts/:id/management?area=educacion[_ca|_ep]`: `{ assigned_user_id?: number, lead_status_id?: number|null, actor_email?: string }`. Actualiza el ciclo actual y refleja la asignación en el chat, si existe. Enviar el mismo `assigned_user_id` confirma el asesor retenido tras un reingreso; otro ID lo reasigna directamente. `assigned_user_id: null` se rechaza.
- `POST /api/crm/education/distribute`: `{ area: "all"|..., channel?, q?, actor_email? }`. Reparte **solo números sin historial previo** con ciclo actual sin asesor ni conflicto entre usuarios provisionados de rol `asesor_comercial` habilitados en cada área, según carga reciente de ciclos abiertos. Los regresos tras 60 días se asignan manualmente. Es idempotente respecto a ciclos ya asignados y devuelve total y distribución por área.
- `PATCH /api/crm/education/entries/:id/review?area=...`: `{ action: "open_new"|"keep_existing"|"dismiss", actor_email? }`. Resuelve manualmente un conflicto.

La migración `20260924100000_education_lead_cycles` crea ciclos y entradas, y recupera orígenes más regresos orgánicos históricos separados por más de 60 días. Los ciclos antiguos sin snapshot de estado/asesor conservan esos campos vacíos; el ciclo más reciente hereda los valores actuales del contacto y chat. Se aplica al desplegar, no desde la pantalla.

### `GET /api/crm/audience`

Audiencia email (opt-in) para mailing SES.

### `GET /api/crm/attribute-definitions?area=pam`

Catálogo (activo e inactivo) para columnas dinámicas en CRM PAM.

### `POST /api/crm/attribute-definitions`

Crear definición (`scope: area|segment`, `slug`, `label`, `field_type`, `options` si es `select`, …).

### `PATCH /api/crm/attribute-definitions/:id?area=pam`

Actualizar label / tipo / options / active.

## Ownership (PAM)

| Capa | Sistema |
|------|---------|
| CRM / contactos | WhatsApp |
| Producto (membresías, MP, históricos) | MALI ONE |
| Vitrina widget | MALI ONE (público; no es CRM) |
| Mailing SES + boletines | MALI ONE |
| Campañas / inbox WhatsApp | WhatsApp |

Sync: **ONE → WhatsApp** en alta/cambio de `PamRegistration` y al vincular históricos. Edición de persona/attrs también desde ONE vía `PATCH`.
