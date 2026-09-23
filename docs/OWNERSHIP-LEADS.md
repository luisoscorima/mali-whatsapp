# Ownership — Leads multicanal

## Dos capas

| Capa | Dónde | Rol |
|------|--------|-----|
| **CRM operativo de leads** (fuente de verdad) | mali-whatsapp (`/leads` + API) | Persona, `lead_status`, orígenes, ownership/asignación, campañas WA |
| **Vitrina CRM Educación** | MALI ONE | Contactos y entradas de los últimos 60 días de las tres áreas; consume WhatsApp — **sin** BD paralela de prospectos. Permite gestionar asesor/estado, distribuir automáticamente solo números sin historial en su área, revisar regresos y conflictos. Reportes y alertas siguen pendientes. |
| **Captura web + dinero** | MALI ONE | Widget → `EducacionLead` (ingestión/reintento); pagos, ROI |

WhatsApp **reemplaza el Excel** de leads. ONE **no** es un segundo CRM de prospectos (sí puede ser la vitrina operativa, como CRM PAM).

Reemplazo del Sheet BBDD EP (verificar / distribuir / reportes): **[LEADS-CRM-EDUCACION.md](LEADS-CRM-EDUCACION.md)**.

## CTWA vs Instant Forms

| | CTWA | Instant Forms (Lead Ads) |
|--|------|---------------------------|
| Acción del usuario | Abre WhatsApp y escribe | Llena formulario en FB/IG |
| Ingestión | Webhook WA `referral` | Webhook Page `leadgen` + Graph `GET /{leadgen_id}` |
| Canal en CRM | `meta_ctwa` | `meta_lead_form` |
| **Área Mali** | Por **`phone_number_id`** de la línea WA (Educación / CA / EP) | Por **`form_id`** → tabla `meta_lead_form_routes` (reglas de nombre del form; sync Graph en `/leads/meta-forms`) |

Misma Página Facebook para CA y EP: el Page ID **no** separa áreas. Convención de nombres:

- `Cursos de Arte…` → `educacion_ca`
- `[FORM EP]…` → `educacion_ep`
- resto → `educacion`

## Modelo en WhatsApp

| Pieza | Qué es |
|-------|--------|
| `contacts` | Persona y estado actual visible también en WhatsApp |
| `contact_origins` | Fuente/canal de la captación |
| `education_lead_entries` | Cada entrada gestionable, clasificada con ventana de 60 días |
| `education_lead_cycles` | Periodo de atención con un asesor, estado y calificación; conserva historial |
| `lead_status_definitions` | Catálogo editable por área |
| `meta_leadgen_*` / `meta_ctwa_*` | Detalle por canal Meta |
| `meta_lead_form_routes` | Instant Form `form_id` → área (CA/EP/Educación); override manual bloquea resync |
| `contact_attributes` | Datos durables de **persona** (PAM, demografía) — **no** origen de campaña |

### Identidad (match)

Al menos uno de `phone`, `dni`, `email`. Orden: **phone → dni → email** → si no hay match, crear.

### Canales (`contact_origins.channel`)

`meta_lead_form` · `meta_ctwa` · `widget` · `mali_one_link` · `tiktok` · `import` · `manual` · `organic_wa` · `other`

## MALI ONE (widget Educación)

1. Persiste captura en `EducacionLead` (reintentos si WA cae).
2. Sync a WhatsApp: persona + **`contact_origins`** (`channel=widget`) — **sin** attrs `source` / `fuente` / `curso`.
3. Sync PAM sigue usando attrs de pago/persona (`plan`, `payment_id`, …).

## UI

Módulo **`/leads`** (hub por canal + listado). La ruta `/anuncios` ya no existe; CTWA vive en `/leads/meta-ctwa`.

## App Meta (Lead Ads)

Ver [CONFIGURACION_META.md](../CONFIGURACION_META.md) § Lead Ads / Instant Forms. Caso de uso *Captar clientes potenciales…*; Page token distinto del WhatsApp token. Si no cabe en la app WA → app Marketing aparte.

## Estado de implementación (handoff)

Resumen de lo hecho, pendientes y decisiones: **[LEADS-ESTADO.md](LEADS-ESTADO.md)**.
