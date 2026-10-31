# Leads

Fuente de verdad de captación, ownership y operación de leads multicanal (Educación). Reemplaza el Sheet BBDD 2026 EP (“Filtrador de Leads”) sin crear un segundo CRM de prospectos.

Relacionado: [CRM-API.md](./CRM-API.md) (contrato HTTP), [AREAS.md](./AREAS.md) · [CATEGORIAS.md](./CATEGORIAS.md) · [LINEAS.md](./LINEAS.md) · [CONTACTOS.md](./CONTACTOS.md), [META-WABA.md](./META-WABA.md) (setup Lead Ads).

Histórico: [LEADS-CHANGELOG.md](./LEADS-CHANGELOG.md). Si chocan, **manda este**.

---

## Quién guarda qué

| Pieza | Dónde | Rol |
|-------|--------|-----|
| **Fuente de verdad** | mali-whatsapp | Persona, orígenes, `lead_status`, ownership/asignación, regla de recontacto, historial, chat y campañas |
| **Vitrina operativa** | MALI ONE (CRM Educación) | UI de asesoras y jefes: listar, verificar, asignar, revisar, reportar. Consume la CRM API. Sin BD paralela de leads |
| **Captura web y dinero** | MALI ONE | Widget → `EducacionLead` (ingesta y reintento) → sync a WhatsApp (`channel=widget`). Pagos y ROI |

WhatsApp **reemplaza el Excel**. MALI ONE es la **vitrina** (mismo patrón que CRM PAM).

**WhatsApp guarda y decide; MALI ONE muestra y opera.**

### Qué hacía el Sheet (referencia)

Menú Apps Script sobre hojas `Subir leads` → `Condensado` → hojas por asesora:

1. **Verificar números** — busca teléfono en bases; la regla vigente usa 60 días exactos desde la última interacción válida.
2. **Copiar al Condensado** — staging → BD operativa.
3. **Distribuir a asesores** — copia a hoja de asesora + email.
4. **Alertas** — leads con asesor y estado vacío +N días.
5. **Reportes** — semanal / mensual / anual / por fechas, **agrupados por fuente**, email a jefes.
6. **Historial** de distribuciones.

---

## Modelo

Alineado con [AREAS.md](./AREAS.md) / [CATEGORIAS.md](./CATEGORIAS.md) / [LINEAS.md](./LINEAS.md):

| Pieza | Qué es |
|-------|--------|
| **Área** | Tenant canónico: solo `educacion` para identidad y captación nuevas |
| **Categoría** | **General** (`program_id` nulo), **CA** o **EP** (`business_programs`). No es un área |
| **Línea** | Número WA; varias por categoría; la conversación es por línea |
| **Persona** (`people`) | Identidad perenne, una sola en el sistema |
| **Ficha** (`contacts`) | Una ficha activa por persona en `educacion` |
| **Origen** (`contact_origins`) | Evento de captación (canal + categoría). Contador del Hub |
| **Entrada** (`education_lead_entries`) | Intento gestionable, ventana 60 días, hacia una categoría |
| **Ciclo** (`education_lead_cycles`) | Atención de una categoría: asesor, estado y calificación |

**Objetivo duro:** `educacion_ca` / `educacion_ep` **no** se usan como área en identidad ni captación. Son aliases históricos / categoría. La ficha y los orígenes nuevos van a `educacion`; la categoría sale de la **línea** (`program_id`) o del **form route** (`program_key`).

| Producto Meta / TikTok | Qué es |
|------------------------|--------|
| **Instant Form** | Llenó un formulario Lead Ads (FB/IG o TikTok) |
| **CTWA** | Escribió por WhatsApp desde un anuncio (`referral`) |
| `meta_leadgen_*` / `meta_ctwa_*` / `tiktok_*` | Detalle por canal |
| `meta_lead_form_routes` / `tiktok_lead_form_routes` | `form_id` → área canónica + `program_key`; `area_locked` bloquea el resync |

La persona es única. CTWA e Instant Form no son dos CRMs: son orígenes de la misma persona si la identidad coincide. Pueden repetirse los intentos. La persona, no.

### Identidad

Match global, en este orden: identidad de WhatsApp (BSUID) → teléfono → DNI → email. Si hay una persona, el lead se asocia a su ficha de Educación. Si no hay, se crean la persona y la ficha. Si las claves chocan, el intento queda en `person_identity_reviews`. Hace falta al menos uno de teléfono, DNI, email o identidad de WhatsApp.

Si el contacto ya existe, se conservan los datos y se rellenan huecos. Instant Form de Meta y TikTok son la excepción: reemplazan el nombre (y el apellido si el form lo trae) para no dejar el alias de WhatsApp de un CTWA previo.

En WhatsApp el nombre es el perfil (`wa_profile_name`). Vacío si no hay, para que Chats use perfil o teléfono. El placeholder `Lead` se reemplaza.

### Canales (`contact_origins.channel`)

`meta_lead_form` · `meta_ctwa` · `widget` · `web_button` · `mali_one_link` · `tiktok` · `organic_wa` · `import` · `other`

`import` = históricos del Sheet. `other` = respaldo. `manual` ya no se acepta en altas nuevas.

---

## Cómo leer el Hub (`/leads`)

Las cards cuentan **eventos de origen**, no personas únicas.

| Card | Canales BD | Qué agrupa |
|------|------------|------------|
| **Meta** | `meta_lead_form` + `meta_ctwa` | Todo FB/IG Ads (form + click-to-WA) |
| **Widget web** | `widget` | Formularios MALI ONE |
| **Botones web** | `web_button` | `wa.me` / WordPress (no widget) |
| **Links / QR** | `mali_one_link` | WA prellenado del catálogo MALI ONE |
| **TikTok** | `tiktok` | Instant Forms TikTok Ads |
| **WhatsApp orgánico** | `organic_wa` | Chat sin otra atribución comercial en la ficha |

Filtro `?channel=meta` = Instant Forms + CTWA. En cada fila, la columna Canal sigue diciendo Instant Forms o Click-to-WhatsApp.

Rutas operativas (no son cards separadas): `/leads/meta-forms`, `/leads/meta-ctwa`, `/leads/tiktok-forms`.

### Canal vs “Solo contacto” / con chat

Son dos ejes distintos:

1. **Canal** = cómo se captó el lead (form, CTWA, widget, …).
2. **`came_with_inbound`** (etiqueta “Solo contacto” en Chat) = si **ella abrió la conversación** en esa captación.

| Situación | Canal | Chat |
|-----------|-------|------|
| Llenó Instant Form y no escribió | Instant Forms | Solo contacto |
| Llenó Instant Form y **ella** abrió WA después | Instant Forms | Con chat (sigue siendo Instant Forms, **no** pasa a CTWA) |
| Respondió a una campaña outbound nuestra | Instant Forms (si el origen es el form) | Sigue Solo contacto |
| Entró desde anuncio Click-to-WhatsApp | Click-to-WhatsApp | Con chat (siempre) |
| Widget: solo datos / ella abre WA | Widget | Solo contacto / con chat (misma regla: ella inicia el hilo) |
| TikTok form ± ella escribe | TikTok | Igual que Instant Form Meta |

**Regla:** responder a una campaña **no** convierte un form en “contacto + chat”. Tiene que haber un hilo cuyo **primer mensaje sea inbound** en o después de la captura del origen (holgura ~5 min). Código: `api/src/leads/lead-origin.util.ts`.

### Meta: Instant Forms vs CTWA

En el Hub = **una card Meta**. En BD = dos canales de ingesta.

| | Instant Forms | CTWA |
|--|---------------|------|
| Acción | Llena form FB/IG | Abre WA y escribe desde el anuncio |
| Ingestión | Webhook Page `leadgen` + Graph | Webhook WA `referral` |
| Canal | `meta_lead_form` | `meta_ctwa` |
| Habitual en Chat | Solo contacto | Contacto + conversación |
| Categoría | `form_id` → route (`program_key`) | Línea (`program_id`: General / CA / EP) |
| Área de ficha | `educacion` | `educacion` |

Un Instant Form **no se convierte** en CTWA si después hay chat: el canal marca la captación; la etiqueta de chat marca si ella inició el hilo.

La Página Facebook **MALI Educación** (`1684299678482303`) cubre General, CA y EP: el Page ID no separa categorías.

---

## Flujo de captación

Solo entra a este CRM el área canónica **`educacion`**. Un origen de otra área (widget sin área → `ti`) queda en contactos/orígenes: no Prospectia ni clasificación aquí.

```text
Conector o inbound de WhatsApp
        ↓
Área canónica educacion + categoría (línea o form)
        ↓
Contacto (crear o enlazar) + contact_origins
        ↓
education_lead_entries (+ ciclo si corresponde)
        ↓
Prospectia (si falla, la entrada ya quedó)
        ↓
CRM Educación en MALI ONE
```

La clasificación de 60 días ocurre al crear la entrada.

### Orígenes

| Canal | Cuándo se registra | Área / categoría |
|-------|--------------------|------------------|
| `meta_lead_form` | Webhook Lead Ads o backfill | Ficha `educacion`. Categoría por nombre del form → `program_key` (CA / EP / General). Override `area_locked` |
| `tiktok` | Webhook o backfill Instant Form | Igual que Meta Instant Form |
| `meta_ctwa` | Inbound WA con `referral` | Ficha `educacion`. Categoría por línea |
| `widget` | `POST /crm/origins` (MALI ONE) | Body → `educacion` si es Educación; si no viene área → `ti` |
| `web_button` | Primer inbound: `ref:web_*` o prefijo «Hola MALI Educación! Vengo desde la web» | Ficha `educacion`; categoría por línea |
| `mali_one_link` | Primer mensaje sin CTWA ni web_button que matchea catálogo | Ficha `educacion`; categoría por línea |
| `organic_wa` | Inbound solo si la ficha/conversación **no** tienen otro origen comercial | Ficha `educacion`; categoría por línea |
| `import` / `other` | `POST /crm/origins` | La del body |

El widget persiste en `EducacionLead` (reintento) y sincroniza origen `widget`, sin atributos `source` / `fuente` / `curso` en esa sync. PAM sigue con atributos de pago.

### Botones web (WordPress / wa.me)

Distinto del **widget** y de CTWA Ads. Meta no manda `referral`; la señal va en el texto del primer mensaje:

1. **Fuerte:** `ref:web` / `ref:web_ca` / `ref:web_ep` / … en el prefill del botón.
2. **Puente:** cuerpo con ancla `¡Hola MALI Educación! Vengo desde la web` (copy histórico del sitio).

Orden de atribución inbound: CTWA → **web_button** → mali_one_link → orgánico.

Backfill: `POST /api/leads/web-buttons/backfill` (dry-run) / `?apply=1`, o  
`node api/scripts/leads-backfill-web-buttons.cjs` / `--apply`.

### Links y QR de MALI ONE

`mali_one_link` se atribuye al **enviar** el WA prellenado, no al clic del acortador. Cuerpo con `ref:{slug}` al inicio (`ref:{slug} · mensaje`); históricos pueden traerlo al final. Sin `ref:`, texto normalizado (≥12 caracteres) vs catálogo. Varios links con el mismo texto → el más exacto + marca ambiguo. Con `referral` de anuncio no se evalúa como link. Los `ref:web_*` van a **web_button**, no aquí.

Backfill: `POST /api/leads/mali-one-links/backfill` (dry-run); `?apply=1` reclasifica orgánicos coincidentes sin abrir ciclo ni Prospectia.

### Orgánico y la sesión de 24 horas

Si la ficha canónica ya tiene Instant Form, CTWA, widget, botón web, TikTok o link (por `contact_id`, teléfono o BSUID en `educacion`):

- **no** se crea `organic_wa`;
- si esa atribución es de las últimas 24 h, la entrada CRM lleva ese canal;
- si es más vieja, la entrada puede ir como `organic_wa` **sin** nueva fila de origen.

Limpieza de orgánicos falsos históricos (form/TikTok previo + orgánico espurio):  
`node api/scripts/leads-cleanup-false-organic.cjs` (dry-run) / `--apply`.

Misma conversación o entrada del mismo contacto en 24 h: no otra entrada; solo `last_interaction_at` (salvo conflicto). Un saliente no amplía la ventana de 60 días.

### Prospectia

Después de persistir la entrada. Busca por teléfono, usuario WA o BSUID.

Sin token / API caída / match ambiguo → `unverified` y el flujo sigue.

El asesor de Prospectia se copia al ciclo solo si: match único no truncado; allá hay conversación abierta/pendiente con email; ese email es usuario del área; el ciclo Mali no tiene asesor y no está en `requires_review`.

Ciclo con asesor, o regreso >60 días (revisión), no se reasignan solos. Al arrancar la API se reconsulta `prospectia_checked_at` nulo. `POST/GET /api/crm/education/prospectia/sync`.

### Clasificación

Cada entrada se compara con el ciclo previo del contacto en esa categoría/contexto:

| Situación | Clasificación | Asesor |
|-----------|---------------|--------|
| Sin historial | `new` / `new_number` | Sin asesor; reparto `POST .../distribute` |
| ≤60 días | `duplicate` / `same_advisor` | Mismo ciclo; actualiza interacción |
| >60 días | `new` / `reassignable` | Ciclo nuevo; conserva asesor previo hasta confirmar; `requires_review` |
| `convertido` / `venta_exitosa` | `conflict` | Revisión manual |
| `no_interesado` y ≤60 días | `conflict` | Igual |

Revisión: `PATCH .../entries/:id/review` (`open_new` / `keep_existing` / `dismiss`). Gestión: `PATCH .../contacts/:id/management` (no acepta `assigned_user_id: null`).

Un contacto puede tener varios ciclos históricos; un asesor vigente por ciclo actual. MALI ONE opera el ciclo y lo refleja en el chat.

---

## Operación

### Hub

- `/leads` — cards (Meta unificada) + listado (`curso`, fuente, programa, chat, fechas).
- `/leads/meta-forms` — rutas, sync Graph, backfill Instant Forms.
- `/leads/meta-ctwa` — anuncios CTWA.
- `/leads/tiktok-forms` — sync/backfill TikTok; listado también en `/leads?channel=tiktok`.
- Ficha de contacto: orígenes y opt-in. La ruta `/anuncios` ya no existe.

### Instant Forms → categoría (General / CA / EP)

`meta_lead_form_routes` / util `lead-form-area.util.ts`. API: `GET/PATCH .../meta-forms/routes`, `POST .../meta-forms/sync-forms`.

| Nombre del form | Categoría |
|-----------------|-----------|
| Empieza con `Cursos de Arte` | CA |
| Contiene `[FORM EP]` / `FORM EP` | EP |
| Resto | General |

- Override UI → `area_locked`.
- Seeds: `1678089499945954` → CA; `1577538393930907` → EP.
- **CTWA → categoría:** línea (`whatsapp_lines.program_id`), no form.

No hay `META_PAGE_*_CA` / `_EP`. Separación por `form_id` o por línea, no por otro Page token.

### Dónde poner el Page token

**Admin → Meta** (`/admin/meta`): un Page ID y un Page access token de MALI Educación. El token de WhatsApp y el Phone Number ID son por línea/credencial de línea.

| Qué tienes | Debugger “Tipo” | ¿Lead Ads en Admin? | ¿`subscribed_apps`? |
|------------|-----------------|---------------------|---------------------|
| System user | System User | No | No |
| Token MALI Educación | Page | Sí | Sí |

Detalle: [META-WABA.md](./META-WABA.md) § Lead Ads / Instant Forms.

Respaldo opcional:

```env
META_PAGE_ACCESS_TOKEN=...
META_PAGE_ID=1684299678482303
```

Caso de uso app Meta: Lead Ads + WhatsApp. Webhook Page + `leadgen`.

### Backfill Instant Forms Meta

UI → `POST /api/leads/meta-forms/backfill`. Page access token obligatorio.

Por lead Graph: contacto + origen + `meta_leadgen_leads`. Custom fields en payload; si la pregunta nombra curso/programa → `payload.curso`. `leadgen_id` duplicado se omite.

### Nombres de anuncios CTWA

`POST /api/meta-ads/sync-names`: Graph batch para filas sin `display_name`. No pisa nombres manuales ni `clid:…`.

### Ads Manager (referencia)

| Cuenta publicitaria | Categoría típica | Forms | WA thank-you |
|---------------------|------------------|-------|--------------|
| MALI - Cursos de arte | CA | `Cursos de Arte - …` | 902043388 |
| MALI - Arte y cultura | EP | `[FORM EP] - …` | 922172157 |

El form crea el lead. Si el anuncio ofrece chatear al final, el mensaje entra por la línea (puede ser CTWA o inbound posterior al form).

### TikTok Instant Forms

- App Marketing API; cuenta leads `TIKTOK_ADVERTISER_ID` (CA y EP juntas).
- Categoría por nombre de form (misma regla que Meta). UI `/leads/tiktok-forms`.
- Webhook `POST/GET {APP_BASE_URL}/webhook/tiktok` → `channel=tiktok`.
- Seeds de forms; forms nuevos por webhook. Env: `TIKTOK_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_ID`, app id/secret.
- Chat: misma marca Solo contacto / con chat que Meta Instant Form (ella inicia el hilo).

---

## Qué falta para apagar el Sheet

El CRM Educación en MALI ONE ya muestra Contactos y Oportunidades. Pagos y Campañas: «Próximamente». El MVP aún no sustituye del todo el flujo diario del Sheet.

| Capacidad | Estado | Notas |
|-----------|--------|--------|
| Ownership del ciclo | Hecho | Un asesor por ciclo |
| Ventana 60 días y clasificación | Hecho | |
| Distribuir números sin historial | Hecho | |
| Reglas extra de conflicto | Pendiente | |
| Alerta sin gestionar (+N días) | Falta | |
| Reportes por fuente + email | Falta | SES desde ONE |
| Estados EP del Sheet | Pendiente | Alinear catálogo |
| Curso en listado | Hecho | `payload.curso` |

### Fases

**Fase 1** — casi cerrada: ciclos, 60 días, reparto; faltan estados EP, conflictos extra y reportes.

**Fase 2** — operación completa: alertas, reportes SES, apagar espejo Sheet (`EDUCACION_LEADS_SHEETS_ENABLED=false`).

### Pendiente operativo (Meta y TikTok)

1. Page token tipo Page y lead de prueba.
2. Sync + backfill de forms clave.
3. CTWA: sync de nombres.
4. TikTok: suscripción LEAD, sync, backfill, prueba.

### Qué no hacer

- Recrear en ONE otra BD tipo Condensado.
- Tratar CTWA e Instant Form como CRMs distintos (sí son canales distintos; misma persona).
- Poner la verdad de la asignación solo en conversaciones.
- Usar `educacion_ca` / `educacion_ep` como área de ficha o captación nueva.
- Contar como “con chat” una respuesta a campaña outbound.

---

## Archivos clave

| Área | Path |
|------|------|
| Ingest Instant Forms Meta | `api/src/leads/meta-leadgen.service.ts` |
| Rutas form→categoría | `api/src/leads/lead-form-area.util.ts` |
| Orígenes, orgánico, enrich chat | `api/src/leads/leads.service.ts` |
| Solo contacto vs con chat | `api/src/leads/lead-origin.util.ts` |
| Identidad inbound canónica | `api/src/webhook/webhook.service.ts`, `api/src/meta-settings/meta-settings.store.ts` |
| Botones web | `api/src/leads/web-button-match.util.ts` |
| Links MALI ONE | `api/src/leads/mali-one-link-match.util.ts` |
| Backfill web | `api/scripts/leads-backfill-web-buttons.cjs` |
| CTWA sync nombres | `api/src/meta-ads/meta-ads.service.ts` |
| TikTok ingest | `api/src/leads/tiktok-leadgen.service.ts` |
| Limpieza orgánicos falsos | `api/scripts/leads-cleanup-false-organic.cjs` |
| UI Hub | `web/src/features/leads/LeadsHubPage.tsx` |
| UI forms / TikTok / CTWA | `MetaFormsPage.tsx`, `TikTokFormsPage.tsx`, `web/src/features/meta-ads/*` |
| Etiquetas canal | `web/src/features/leads/originDisplay.ts` |
