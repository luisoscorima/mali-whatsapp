# CRM API — contrato interno (MALI ONE ↔ WhatsApp)

Fuente de verdad de **personas PAM**: `mali-whatsapp-mvp` (`contacts`, área `pam`).

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

### `POST /api/crm/sync`

Upsert de contacto desde producto (`PamRegistration`).

```json
{
  "area": "pam",
  "name": "Ana",
  "last_name": "Pérez",
  "phone": "51999888777",
  "email": "ana@example.com",
  "opt_in": true,
  "opt_in_email": true,
  "external_id": "clx...",
  "attributes": {
    "dni": "12345678",
    "plan": "amigo",
    "frecuencia": "yearly",
    "mp_status": "approved",
    "expiry": "2027-07-21"
  }
}
```

- Teléfono: E.164 **sin** `+`.
- Match: `(area, phone)`.
- Atributos se upsertan en `contact_attributes` (incl. `mali_one_id` si hay `external_id`).

Respuesta:

```json
{
  "ok": true,
  "data": {
    "contact_id": 42,
    "area": "pam",
    "phone": "51999888777",
    "email": "ana@example.com",
    "created": false
  }
}
```

### `GET /api/crm/contacts`

Listado CRM (todos los contactos activos del área, no solo audiencia email).

Query: `area`, `q`, `segment`, `has_email`, `opt_in_email`, `attr_key`, `attr_value`, `page`, `limit`.

Query:

| Param | Default | Descripción |
|-------|---------|-------------|
| `area` | `pam` | Área CRM |
| `segment` | — | Slug de segmento |
| `opt_in_email` | `true` | Solo opt-in email |
| `attr_key` / `attr_value` | — | Filtro por atributo |
| `page` | `1` | |
| `limit` | `500` | máx. 2000 |

Solo contactos `active`, con email, no reemplazados.

## Ownership (PAM)

| Capa | Sistema |
|------|---------|
| CRM / contactos | WhatsApp |
| Producto (membresías, MP, históricos) | MALI ONE |
| Vitrina widget | MALI ONE (público; no es CRM) |
| Mailing SES + boletines | MALI ONE |
| Campañas / inbox WhatsApp | WhatsApp |

Sync: **ONE → WhatsApp** en alta/cambio de `PamRegistration` (create, admin PATCH, webhook Mercado Pago).
