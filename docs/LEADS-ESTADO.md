# Leads — estado y handoff (ago 2026)

Documento para retomar el trabajo de leads multicanal sin redescubrir decisiones. Ownership estable: [OWNERSHIP-LEADS.md](OWNERSHIP-LEADS.md). Setup Meta: [CONFIGURACION_META.md](../CONFIGURACION_META.md) §16.

## Modelo mental (no confundir)

| Pieza | Qué es |
|-------|--------|
| **Contacto** | Persona (tel, email, nombre) en un área |
| **Origen** (`contact_origins`) | Evento de captación: widget, Instant Form, CTWA, etc. |
| **CTWA** | Entró escribiendo por WhatsApp desde un anuncio |
| **Instant Form** | Llenó formulario Lead Ads (FB/IG); puede abrir WA después |
| **Sheet de Meta** | Export de forms; espejo temporal; Mali debe reemplazarlo a medio plazo |

Misma persona = mismo **teléfono / dni / email** en la **misma área**. CTWA e Instant Form no son dos CRMs: son orígenes del mismo contacto si matchean.

---

## Qué ya está en código

### Hub y UI

- `/leads` — resumen por canal + listado unificado de orígenes (curso, fuente, programa, chat).
- `/leads/meta-forms` — Instant Forms: rutas form→área, sync Graph, backfill, leads recientes + abrir chat.
- `/leads/meta-ctwa` — anuncios CTWA; nombre manual o sync Graph; detalle + leads.
- Ficha contacto: orígenes de captación + opt-in marketing.
- Indicador chat: `came_with_inbound` (por origen: CTWA con `conversation_id`; widget con inbound real; Instant Form = solo contacto).

### Instant Forms → área (CA / EP / Educación)

Misma Página Facebook **MALI Educación** → el Page ID **no** separa áreas.

Tabla `meta_lead_form_routes` (`form_id` → `area`):

| Nombre del form | Área |
|-----------------|------|
| Empieza con `Cursos de Arte` | `educacion_ca` |
| Contiene `[FORM EP]` / `FORM EP` | `educacion_ep` |
| Resto | `educacion` |

- Override manual en UI → `area_locked` (el sync no lo pisa).
- Seeds Sheets: `1678089499945954` → CA; `1577538393930907` → EP.
- Migración: `api/prisma/migrations/20260827030000_meta_lead_form_routes/`.
- Util: `api/src/leads/lead-form-area.util.ts`.
- API: `GET/PATCH .../meta-forms/routes`, `POST .../meta-forms/sync-forms`.

**CTWA → área:** por `phone_number_id` de la línea WA (902… CA, 922… EP, etc.), no por form.

### Backfill Instant Forms históricos

- UI: Form ID + **Importar leads** → `POST /api/leads/meta-forms/backfill`.
- Requiere Page access token.
- Por cada lead Graph: crea/actualiza **contacto** (tel, email, dni, nombre) + origen + `meta_leadgen_leads`.
- Preguntas custom (curso, etc.) → **payload del origen** (`field_data` / `mapped`), no columnas fijas del contacto.
- Si el contacto ya existía (p. ej. CTWA): solo rellena campos **vacíos** (no sobrescribe).
- `leadgen_id` duplicado → skip.

### Nombres de anuncios CTWA

- Antes solo `meta_source_id` (ID largo); `display_name` era manual.
- `POST /api/meta-ads/sync-names`: batch Graph `?ids=…&fields=name` para filas **sin** nombre.
- Omite `clid:…`. No pisa nombres manuales.
- Token: page access token del área, o WhatsApp token.
- Botón en sidebar CTWA: **Sincronizar nombres desde Meta**.

### Meta Developers / operación

- Caso de uso Lead Ads + WhatsApp en la misma app.
- Webhook Page + `leadgen` + verify token (ya validado con curl 200).
- Page ID MALI Educación: `1684299678482303`.
- Flujo de token y `subscribed_apps` (hecho en prod): ver abajo + [CONFIGURACION_META.md](../CONFIGURACION_META.md) §16.

### System User ≠ Page token (error frecuente `#210`)

| Qué tienes | Debugger “Tipo” | ¿Va en `/admin/meta` Lead Ads? | ¿Sirve en `POST /{page-id}/subscribed_apps`? |
|------------|-----------------|--------------------------------|-----------------------------------------------|
| Token **sistemas API** (system user) | **System User** | **No** | **No** → `(#210) A page access token is required` |
| Token de **MALI Educación** | **Page** | **Sí** | **Sí** → `{"success":true}` |

El system user **solo** sirve para **obtener** el Page token:

```bash
curl -G "https://graph.facebook.com/v23.0/1684299678482303" \
  -d "fields=access_token,name,id" \
  -d "access_token={SYSTEM_USER_TOKEN}"
# → usa el access_token del JSON (Tipo: Page)
```

Detalle y `me/accounts`: [CONFIGURACION_META.md](../CONFIGURACION_META.md) §16.

### Dónde poner el Page token y el Page ID

**Respuesta corta:** en **Admin → Meta** (`/admin/meta`), el **Page** token (no el system user ni el WhatsApp). Un solo Page ID + un solo Page access token (MALI Educación) para CA/EP/Educación.

| Qué | Dónde | Valor |
|-----|--------|--------|
| Page access token (Lead Ads) | Admin → Meta → selector de área | Token **Tipo: Page** de `1684299678482303` |
| Page ID (Lead Ads) | Mismo panel | `1684299678482303` |

**Cómo (recomendado):**

1. Obtener Page token desde el system user (tabla arriba / CONFIGURACION_META §16).
2. Ir a **`/admin/meta`**.
3. En **`educacion`**, pegar Page token + Page ID, Guardar.
4. Repetir lo **mismo** en **`educacion_ca`** y **`educacion_ep`**.
5. Suscribir: `POST .../1684299678482303/subscribed_apps` con `subscribed_fields=leadgen` y el **Page** token.
6. Lead de prueba.

**Por qué no basta solo `.env`:** el webhook busca el Page ID en BD (`app_settings`) para asociar la Página a un área. Si solo está en env, ese lookup falla y el fallback es `ti` (luego el `form_id` aún puede corregir el área, pero es frágil). Prioridad de lectura: **área en Admin → env**.

**`.env` (opcional, respaldo global — no por área):**

```env
META_PAGE_ACCESS_TOKEN=...   # Page token, no system user
META_PAGE_ID=1684299678482303
```

No existen `META_PAGE_*_CA` / `_EP`: CA/EP se separan por **form_id** (Instant Forms) o **phone_number_id** (CTWA), no por otro Page token.

**No confundir:** WhatsApp token / Phone number ID = **por área**. Page token = **Página de Facebook**, compartido. System user token = **herramienta** para generar el Page token, no el valor final.

---

## Ads Manager (referencia operativa)

| Cuenta publicitaria | Línea | Forms típicos | WA thank-you |
|---------------------|-------|---------------|--------------|
| MALI - Cursos de arte | CA | `Cursos de Arte - …` | 902043388 |
| MALI - Arte y cultura | EP | `[FORM EP] - …` | 922172157 |

Anuncios Instant Form: destino formulario + a menudo “chatear en WhatsApp” al final → el form crea el lead CRM; el WA enruta por número si escriben.

---

## Pendiente / siguiente (prioridad sugerida)

1. **Operación Meta:** ~~Page token + `subscribed_apps` leadgen~~ (hecho). Confirmar Page token en `/admin/meta` (educacion + ca + ep) si aún no está el **Page** token → lead de prueba.
2. **Servidor:** `npx prisma migrate deploy` (tabla rutas) si aún no está en prod.
3. **Históricos forms:** sync forms + backfill por `form_id` clave (espejo del Sheet).
4. **CTWA:** sync nombres en cada área con anuncios sin `display_name`.
5. **Producto (después):** mostrar curso/campos custom del payload en UI con claridad; opcional mapear a `contact_attributes`.
6. **No priorizar ahora:** mapa por cuenta publicitaria / `ad_id` (menos estable que `form_id`); reasignar leads ya ingestados en área incorrecta.

---

## Archivos clave

| Área | Path |
|------|------|
| Ingest Instant Forms | `api/src/leads/meta-leadgen.service.ts` |
| Rutas form→área | `api/src/leads/lead-form-area.util.ts` |
| Orígenes / contacto | `api/src/leads/leads.service.ts` |
| Chat hints | `api/src/leads/lead-origin.util.ts` |
| CTWA sync nombres | `api/src/meta-ads/meta-ads.service.ts` |
| UI forms | `web/src/features/leads/MetaFormsPage.tsx` |
| UI CTWA | `web/src/features/meta-ads/*` |
| Display orígenes | `web/src/features/leads/originDisplay.ts` |
