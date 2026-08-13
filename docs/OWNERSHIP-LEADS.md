# Ownership — Leads multicanal

## Dos capas

| Capa | Dónde | Rol |
|------|--------|-----|
| **CRM operativo de leads** | mali-whatsapp (`/leads`) | Persona, `lead_status`, orígenes, operación, campañas WA |
| **Captura web + dinero** | MALI ONE | Widget → `EducacionLead` (ingestión/reintento); pagos, ROI |

WhatsApp **reemplaza el Excel** de leads. ONE **no** es un segundo CRM de prospectos.

## CTWA vs Instant Forms

| | CTWA | Instant Forms (Lead Ads) |
|--|------|---------------------------|
| Acción del usuario | Abre WhatsApp y escribe | Llena formulario en FB/IG |
| Ingestión | Webhook WA `referral` | Webhook Page `leadgen` + Graph `GET /{leadgen_id}` |
| Canal en CRM | `meta_ctwa` | `meta_lead_form` |

## Modelo en WhatsApp

| Pieza | Qué es |
|-------|--------|
| `contacts` | Persona + `lead_status_id` |
| `contact_origins` | Evento/touch de captura (verdad del lead) |
| `lead_status_definitions` | Catálogo editable por área |
| `meta_leadgen_*` / `meta_ctwa_*` | Detalle por canal Meta |
| `contact_attributes` | Datos durables de **persona** (PAM, demografía) — **no** origen de campaña |

### Identidad (match)

Al menos uno de `phone`, `dni`, `email`. Orden: **phone → dni → email** → si no hay match, crear.

### Canales (`contact_origins.channel`)

`meta_lead_form` · `meta_ctwa` · `widget` · `tiktok` · `import` · `manual` · `organic_wa` · `other`

## MALI ONE (widget Educación)

1. Persiste captura en `EducacionLead` (reintentos si WA cae).
2. Sync a WhatsApp: persona + **`contact_origins`** (`channel=widget`) — **sin** attrs `source` / `fuente` / `curso`.
3. Sync PAM sigue usando attrs de pago/persona (`plan`, `payment_id`, …).

## UI

Módulo **`/leads`** (hub por canal + listado). La ruta `/anuncios` ya no existe; CTWA vive en `/leads/meta-ctwa`.

## App Meta (Lead Ads)

Ver [CONFIGURACION_META.md](../CONFIGURACION_META.md) § Lead Ads / Instant Forms. Caso de uso *Captar clientes potenciales…*; Page token distinto del WhatsApp token. Si no cabe en la app WA → app Marketing aparte.
