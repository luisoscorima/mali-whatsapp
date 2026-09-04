# CRM API — contrato interno (MALI ONE ↔ WhatsApp)

Fuente de verdad de **personas PAM**: `mali-whatsapp` (`contacts`, área `pam`).

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
  "body_params": ["Ana"]
}
```

- Idempotente por `idempotency_key` (attr `pam_wa_template_sent` en contacto).
- Requiere contacto existente con ese teléfono en el área.

### `PATCH /api/crm/contacts/:id?area=pam`

Edición parcial de persona + attrs + `segment_slugs` (bidireccional desde MALI ONE).

### `GET /api/crm/contacts`

Listado CRM (contactos activos del área). Incluye `dni`, `email`, `segment_slugs`, `attributes`.

Query: `area`, `q`, `segment`, `has_email`, `opt_in_email`, `attr_key`, `attr_value`, `page`, `limit`.

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
