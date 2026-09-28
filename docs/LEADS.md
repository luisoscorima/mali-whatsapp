# Leads

Fuente de verdad de captación, ownership y operación de leads multicanal (Educación). Reemplaza el Sheet BBDD 2026 EP (“Filtrador de Leads”) sin crear un segundo CRM de prospectos.

Relacionado: [CRM-API.md](./CRM-API.md) (contrato HTTP), [MODELO-WABA-AREAS.md](./MODELO-WABA-AREAS.md) (tenant por área), [CONFIGURACION_META.md](../CONFIGURACION_META.md) §16 (setup Lead Ads).

---

## Quién guarda qué

| Pieza | Dónde | Rol |
|-------|--------|-----|
| **Fuente de verdad** | mali-whatsapp | Persona, orígenes, `lead_status`, ownership/asignación, regla de recontacto, historial, chat y campañas |
| **Vitrina operativa** | MALI ONE (CRM Educación) | UI de asesoras y jefes: listar, verificar, asignar, revisar, reportar. Consume la CRM API. Sin BD paralela de leads |
| **Captura web y dinero** | MALI ONE | Widget → `EducacionLead` (ingesta y reintento) → sync a WhatsApp (`channel=widget`). Pagos y ROI |

WhatsApp **reemplaza el Excel**. MALI ONE es la **vitrina** (mismo patrón que CRM PAM): no mantiene un “Condensado” ni hojas por asesora.

**WhatsApp guarda y decide; MALI ONE muestra y opera.** El Sheet se apaga cuando verificar → asignar → alertar → reportar por fuente vive sobre contactos y orígenes de WhatsApp.

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

| Pieza | Qué es |
|-------|--------|
| **Contacto** (`contacts`) | Persona en un área (teléfono, email, nombre) y estado actual |
| **Origen** (`contact_origins`) | Evento de captación: widget, Instant Form, CTWA, TikTok, link, orgánico, import |
| **Entrada** (`education_lead_entries`) | Cada entrada gestionable, clasificada con la ventana de 60 días |
| **Ciclo** (`education_lead_cycles`) | Periodo de atención con un asesor, estado y calificación; conserva historial |
| **CTWA** | Entró escribiendo por WhatsApp desde un anuncio (`referral`) |
| **Instant Form** | Llenó un formulario Lead Ads (FB/IG); puede abrir WhatsApp después |
| `lead_status_definitions` | Catálogo de estados editable por área |
| `meta_leadgen_*` / `meta_ctwa_*` | Detalle por canal Meta |
| `meta_lead_form_routes` | Instant Form `form_id` → área; override manual (`area_locked`) bloquea el resync |
| `contact_attributes` | Datos durables de la persona (PAM, demografía). No son el origen de campaña |

Misma persona = mismo teléfono, DNI o email en la **misma área**. CTWA e Instant Form no son dos CRMs: son dos orígenes del mismo contacto si la identidad coincide.

El Sheet de Meta (export de forms) es un espejo temporal. Mali lo reemplaza.

### Identidad

Match dentro del área, en este orden: identidad de WhatsApp (BSUID) → teléfono → DNI → email. Si no hay match, se crea el contacto. Hace falta al menos uno de teléfono, DNI o email.

Si el contacto ya existe, se conservan los datos que ya tiene y se rellenan los huecos (teléfono, BSUID, DNI, email, apellido). Instant Form de Meta y TikTok son la excepción: reemplazan el nombre, y el apellido si el formulario lo trae, para no dejar el alias de WhatsApp que a veces quedó de un CTWA.

Si no existe, se crea con los datos del lead. En WhatsApp el nombre es el perfil (`wa_profile_name`). Si no hay nombre, se guarda vacío para que Chats use perfil o teléfono. Un nombre guardado como el placeholder `Lead` se reemplaza.

### Canales (`contact_origins.channel`)

`meta_lead_form` · `meta_ctwa` · `widget` · `mali_one_link` · `tiktok` · `organic_wa` · `import` · `other`

`import` queda reservado para los históricos del Sheet (`POST /crm/origins` lo acepta; aún no hay pantalla). `other` es respaldo si llega un canal que la UI no nombra. `manual` ya no se acepta en altas nuevas.

### CTWA vs Instant Forms

| | CTWA | Instant Forms (Lead Ads) |
|--|------|---------------------------|
| Acción | Abre WhatsApp y escribe | Llena un formulario en FB/IG |
| Ingestión | Webhook WA `referral` | Webhook Page `leadgen` + Graph `GET /{leadgen_id}` |
| Canal | `meta_ctwa` | `meta_lead_form` |
| Área | Por `phone_number_id` de la línea | Por `form_id` → `meta_lead_form_routes` |

La misma Página Facebook (**MALI Educación**, `1684299678482303`) cubre CA y EP: el Page ID **no** separa áreas.

---

## Flujo de captación

Solo entran a este CRM las áreas `educacion`, `educacion_ca` y `educacion_ep`. Un origen de otra área (el widget sin área cae en `ti`) queda en contactos y orígenes: no se consulta en Prospectia ni se clasifica aquí.

```text
Conector o inbound de WhatsApp
        ↓
Contacto (crear o enlazar) + contact_origins
        ↓
Si el área es de educación → education_lead_entries (+ ciclo si corresponde)
        ↓
Consulta a Prospectia sobre esa entrada (si falla, la entrada ya quedó)
        ↓
CRM Educación en MALI ONE: reparto, reasignación, conflictos
```

La clasificación de 60 días ocurre al crear la entrada, no en un paso posterior.

### Orígenes

| Canal | Cuándo se registra | Área |
|-------|--------------------|------|
| `meta_lead_form` | Webhook Lead Ads o backfill | Nombre del formulario: `Cursos de Arte` / `[FORM CA]` → CA; `[FORM EP]` → EP; resto → Educación. Override manual con `area_locked` |
| `tiktok` | Webhook o backfill de Instant Form | La misma regla de nombre que Meta |
| `meta_ctwa` | Inbound de WhatsApp con `referral` | Línea (`phone_number_id`), como el resto del chat |
| `widget` | MALI ONE hace `POST /crm/origins` | La que envíe el body. Si no viene, `ti` (no entra a este CRM) |
| `mali_one_link` | Primer mensaje sin anuncio CTWA, si el texto encaja con el catálogo de links de MALI ONE | La línea de WhatsApp |
| `organic_wa` | Inbound en una de las tres áreas, solo si ese contacto o esa conversación no tienen ya otro origen | La línea de WhatsApp |
| `import` / `other` | `POST /crm/origins` | La que envíe el body |

El widget de MALI ONE persiste la captura en `EducacionLead` (reintenta si WhatsApp cae) y sincroniza persona + origen `widget`, sin atributos `source` / `fuente` / `curso`. El sync PAM sigue usando atributos de pago y persona (`plan`, `payment_id`, …).

### Links y QR de MALI ONE

`mali_one_link` se atribuye al **enviar** el WhatsApp prellenado, no al hacer clic en el acortador. El cuerpo trae `ref:{slug}` al inicio (`ref:{slug} · mensaje`); los históricos pueden traerlo al final. Si no hay `ref:`, el texto normalizado (mínimo 12 caracteres) debe coincidir con el catálogo. Si varios links comparten el mismo texto, se toma el más exacto y se marca ambiguo. Si el catálogo no responde, el match por texto no corre. Un mensaje con `referral` de anuncio no se evalúa como link.

Históricos orgánicos: `POST /api/leads/mali-one-links/backfill` cuenta coincidencias del primer inbound; `?apply=1` los pasa a `mali_one_link` (slug y etiqueta) sin abrir otro ciclo ni consultar Prospectia. Omite textos ambiguos.

### Conversación o solo contacto

`came_with_inbound` marca cómo se captó el origen. No bifurca el CRM.

| Canal | Cuenta como conversación |
|-------|--------------------------|
| `meta_ctwa`, `organic_wa`, `mali_one_link` | Si el origen tiene `conversation_id` |
| `widget` | Si el chat resuelto ya tiene un mensaje inbound del lead |
| `meta_lead_form`, `tiktok`, `import`, `other` | Nunca. Un chat posterior no cambia la marca |

### Orgánico y la sesión de 24 horas

El orgánico no es “cualquier lead sin payload”. Si el contacto o la conversación ya tienen un Instant Form, un CTWA, un widget o un link MALI ONE:

- no se crea un origen `organic_wa`;
- si esa atribución se vio en las últimas 24 horas, el inbound se registra con el canal de esa atribución;
- si es más vieja, la entrada de educación se guarda como `organic_wa` sin abrir otra fila de origen.

Los mensajes de la misma conversación dentro de 24 horas, o una entrada de educación del mismo contacto en esa ventana, no generan otra entrada. Solo mueven `last_interaction_at`, salvo que la entrada vigente sea un conflicto. Un mensaje saliente no amplía la ventana de 60 días.

### Prospectia

La consulta ocurre después de persistir la entrada, no antes. Busca por teléfono, usuario de WhatsApp o BSUID.

Si no hay token, la API no responde o la búsqueda es ambigua, el match queda `unverified` y el flujo sigue. La entrada ya está guardada.

El asesor de Prospectia se copia al ciclo solo si se cumplen todas estas condiciones:

- el match es único y la búsqueda no vino truncada;
- allá hay una conversación abierta o pendiente con email de asesor;
- ese email es un usuario provisionado del área;
- el ciclo de Mali no tiene asesor y no está marcado para revisión (`requires_review`).

Un ciclo que ya trae asesor, o un regreso de más de 60 días (queda en revisión y conserva al asesor anterior), no se reasigna solo por Prospectia.

Al arrancar la API se reconsulta lo que nunca se marcó (`prospectia_checked_at` nulo). `POST /api/crm/education/prospectia/sync` relanza la pasada sobre todas las entradas; `GET` del mismo path devuelve el avance.

### Clasificación

Cada entrada de las tres áreas se compara con el ciclo previo de ese contacto en esa área:

| Situación | Clasificación | Qué pasa con el asesor |
|-----------|---------------|------------------------|
| Sin historial | `new` / `new_number` | Sin asesor. El reparto automático (`POST /api/crm/education/distribute`) lo asigna por carga entre `asesor_comercial` del área |
| Última interacción hace 60 días o menos | `duplicate` / `same_advisor` | Sigue el mismo ciclo. Se actualiza la fecha de interacción |
| Última interacción hace más de 60 días | `new` / `reassignable` | Ciclo nuevo. Conserva al asesor anterior hasta que alguien lo confirme o lo cambie. El estado del contacto vuelve al default. `requires_review` |
| Estado `convertido` o `venta_exitosa` | `conflict` | No se abre ciclo solo. Revisión manual |
| Estado `no_interesado` y última interacción dentro de 60 días | `conflict` | Igual |

La revisión de un conflicto (`PATCH /api/crm/education/entries/:id/review`) acepta `open_new` (ciclo nuevo reasignable), `keep_existing` (se trata como duplicado del mismo asesor) o `dismiss`. `PATCH .../contacts/:id/management` cambia asesor o estado del ciclo actual; `assigned_user_id: null` se rechaza.

Un contacto puede tener varios ciclos históricos; solo el ciclo actual tiene un asesor responsable vigente. Los ciclos futuros conservan estado y calificación. La migración no puede reconstruir snapshots antiguos.

El CRM Educación de MALI ONE gestiona un asesor por ciclo y lo refleja en el chat. Cada mensaje sigue identificado por su remitente. Los estados siguen siendo el catálogo CRM del área; la taxonomía del Sheet aún requiere alineación.

---

## Operación

### Hub

- `/leads` — resumen por canal y listado unificado de orígenes (curso, fuente, programa, chat).
- `/leads/meta-forms` — Instant Forms: rutas form→área, sync Graph, backfill, leads recientes y abrir chat.
- `/leads/meta-ctwa` — anuncios CTWA; nombre manual o sync Graph; detalle y leads.
- `/leads/tiktok-forms` — Instant Forms de TikTok.
- Ficha de contacto: orígenes de captación y opt-in de marketing.
- La ruta `/anuncios` ya no existe.

### Instant Forms → área (CA / EP / Educación)

Tabla `meta_lead_form_routes` (`form_id` → `area`). Util: `api/src/leads/lead-form-area.util.ts`. API: `GET/PATCH .../meta-forms/routes`, `POST .../meta-forms/sync-forms`. Migración: `api/prisma/migrations/20260827030000_meta_lead_form_routes/`.

| Nombre del form | Área |
|-----------------|------|
| Empieza con `Cursos de Arte` | `educacion_ca` |
| Contiene `[FORM EP]` / `FORM EP` | `educacion_ep` |
| Resto | `educacion` |

- Override manual en UI → `area_locked` (el sync no lo pisa).
- Seeds Sheets: `1678089499945954` → CA; `1577538393930907` → EP.
- **CTWA → área:** por `phone_number_id` (902… CA, 922… EP), no por form.

No existen `META_PAGE_*_CA` / `_EP`. CA y EP se separan por `form_id` (Instant Forms) o `phone_number_id` (CTWA), no por otro Page token.

### Dónde poner el Page token

En **Admin → Meta** (`/admin/meta`): un solo Page ID y un solo Page access token de MALI Educación, repetido en `educacion`, `educacion_ca` y `educacion_ep`. El token de WhatsApp y el Phone Number ID sí son por área.

| Qué tienes | Debugger “Tipo” | ¿Va en `/admin/meta` Lead Ads? | ¿Sirve en `POST /{page-id}/subscribed_apps`? |
|------------|-----------------|--------------------------------|-----------------------------------------------|
| Token de sistemas API (system user) | System User | No | No → `(#210) A page access token is required` |
| Token de MALI Educación | Page | Sí | Sí → `{"success":true}` |

El system user solo sirve para obtener el Page token (Graph `GET /1684299678482303?fields=access_token` con el system user). Detalle y `subscribed_apps`: [CONFIGURACION_META.md](../CONFIGURACION_META.md) §16.

El webhook busca el Page ID en BD (`app_settings`) para asociar la Página a un área. Si solo está en `.env`, ese lookup falla y el fallback es `ti` (el `form_id` aún puede corregir el área, pero es frágil). Prioridad: **área en Admin → env**.

Respaldo global opcional (no por área):

```env
META_PAGE_ACCESS_TOKEN=...   # Page token, no system user
META_PAGE_ID=1684299678482303
```

Caso de uso en la app Meta: Lead Ads + WhatsApp. Webhook Page + `leadgen`. Si no cabe en la app de WhatsApp, app Marketing aparte.

### Backfill de Instant Forms

UI: Form ID + **Importar leads** → `POST /api/leads/meta-forms/backfill`. Requiere Page access token.

Por cada lead de Graph: crea o actualiza contacto (teléfono, email, DNI, nombre) + origen + `meta_leadgen_leads`. Preguntas custom van al payload del origen (`field_data` / `mapped`), no a columnas fijas del contacto. Si la pregunta contiene la palabra curso, cursos, programa o programas, la respuesta se copia a `payload.curso`. Al arrancar la API se rellenan los Instant Forms de Meta y TikTok que ya estaban guardados con ese campo vacío. `leadgen_id` duplicado se omite y no vuelve a leer el lead en Graph.

### Nombres de anuncios CTWA

`POST /api/meta-ads/sync-names`: batch Graph `?ids=…&fields=name` para filas sin `display_name`. Omite `clid:…` y no pisa nombres manuales. Token: page access token del área, o WhatsApp token. Botón en el sidebar CTWA: **Sincronizar nombres desde Meta**.

### Ads Manager

| Cuenta publicitaria | Línea | Forms típicos | WA thank-you |
|---------------------|-------|---------------|--------------|
| MALI - Cursos de arte | CA | `Cursos de Arte - …` | 902043388 |
| MALI - Arte y cultura | EP | `[FORM EP] - …` | 922172157 |

El form crea el lead en el CRM. Si el anuncio ofrece “chatear en WhatsApp” al final, el mensaje entra por la línea.

### TikTok Instant Forms

- App Marketing API `Mali One Whatsapp` en `business-api.tiktok.com` (aprobada).
- Cuenta de leads: **MALI Cursos de Arte y Extensión Profesional** (`TIKTOK_ADVERTISER_ID`). CA y EP en la misma cuenta.
- Área por nombre del form, igual que Meta. Override con `area_locked`.
- UI `/leads/tiktok-forms`: sync (`page/get` LEAD_GEN, decora forms sembrados vía `GET /page/field/get/`) → rutas `tiktok_lead_form_routes`; backfill por `form_id` (`page/lead/task` + download); lista de leads del área.
- Webhook: `POST/GET {APP_BASE_URL}/webhook/tiktok` → `TikTokLeadgenService` → `channel=tiktok`. Sin `TIKTOK_WEBHOOK_SECRET`: TikTok no envía Bearer. Debe devolver 2xx solo después de persistir el lead.
- La suscripción (`/subscription/subscribe/`) usa `subscribe_entity: "LEAD"` y `callback_url` (además de `app_id`, `secret` y `subscription_detail`). El payload del webhook es otro contrato: puede traer `object: 1` y `entry[].id/page_id/changes[]`.
- Lead Management v2 no lista Instant Forms: seeds en `20260917140000_tiktok_lead_form_routes_seeds` (9 form IDs del Lead Center). Forms nuevos: alta automática por webhook (`page_id`).
- Env: `TIKTOK_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_ID`, `TIKTOK_APP_ID` / `SECRET` (OAuth manual). Redirect: `{APP_BASE_URL}/api/auth/tiktok/callback`.
- Token de Admin con permiso de leads si `lead/get` o el download fallan. Ops: `prisma migrate deploy` (seeds) → Sync forms → lead de prueba.

---

## Qué falta para apagar el Sheet

El CRM Educación de MALI ONE ya muestra Contactos y Leads de los tres números. Pagos y Campañas siguen como «Próximamente». Este MVP no sustituye todavía el flujo diario del Sheet.

| Capacidad | Estado | Notas |
|-----------|--------|--------|
| Ownership del ciclo de lead | Hecho | Un asesor por ciclo |
| Ventana de 60 días y clasificación | Hecho | Nuevos, número nuevo, duplicado/mismo asesor, reasignable y conflicto, por área de entrada |
| Distribuir números sin historial | Hecho | Solo teléfonos sin historial en ese número, por carga reciente de ciclos abiertos. Los regresos de más de 60 días conservan al asesor y requieren confirmarlo o cambiarlo. Auditoría en `audit_logs` |
| Reglas adicionales de conflicto | Pendiente | Primeras reglas: convertido/venta exitosa y no interesado reciente |
| Alerta sin gestionar (+N días) | Falta | Job en WhatsApp o disparo desde ONE |
| Reportes por fuente + email | Falta | Datos en orígenes; envío con SES desde ONE (como CRM PAM) |
| Infra de email saliente en WhatsApp | No | Preferible SES desde ONE |
| Estados EP del Sheet | Pendiente | Alinear o mapear al catálogo `lead_status_definitions` del área |
| Curso en el listado | Hecho | `payload.curso` en widget, links y, si la pregunta lo nombra, Instant Forms de Meta y TikTok. Otros campos custom siguen en el payload |

| Capacidad | Implementar en |
|-----------|----------------|
| Verificar teléfono / regla de recontacto | API WhatsApp |
| Asignar asesora / historial de distribución | API WhatsApp |
| Estados / catálogo EP | WhatsApp (`lead_status_definitions`) |
| Alertas “sin gestionar” | Job WhatsApp o ONE llamando a WhatsApp |
| Reportes por fuente × periodo + email | ONE (UI + SES); agregación vía CRM API o export |
| Pantalla diaria de asesoras y jefes | CRM Educación en MALI ONE |
| Hub técnico Meta (forms, rutas, backfill) | WhatsApp `/leads` |

### Fases

**Fase 1 — dejar de depender del Sheet (casi cerrada):** ciclos, ventana de 60 días, revisión inicial y reparto de números sin historial ya están. Quedan el mapeo de estados EP, reglas extra de conflicto y los reportes.

**Fase 2 — operación completa:** ampliar CRM Educación en ONE (alertas y detalle vía [CRM-API](./CRM-API.md)), reportes por fuente (semana / mes / año / rango) con email SES, cron de leads sin gestionar, y apagar el espejo Sheet (`EDUCACION_LEADS_SHEETS_ENABLED=false` en ONE) y el Apps Script cuando el flujo diario ya no los use.

### Pendiente operativo (Meta y TikTok)

1. Confirmar el Page token (tipo Page, no system user) en `/admin/meta` para `educacion`, `educacion_ca` y `educacion_ep`, y un lead de prueba.
2. `npx prisma migrate deploy` en producción si faltan las tablas de rutas.
3. Históricos de forms: sync + backfill por `form_id` clave (espejo del Sheet).
4. CTWA: sync de nombres en cada área con anuncios sin `display_name`.
5. TikTok: suscripción LEAD, sync, backfill y lead de prueba.
6. No priorizar: mapa por cuenta publicitaria o `ad_id` (menos estable que `form_id`); reasignar leads ya ingestados en un área incorrecta.

### Qué no hacer

- Recrear en ONE otra BD de leads tipo Condensado + hojas por asesora.
- Tratar CTWA e Instant Form como CRMs distintos.
- Poner la fuente de verdad de la asignación solo en conversaciones: el lead tiene ownership aunque aún no haya chat.
- Un cliente API distinto por línea de WhatsApp. El tenant es el área de negocio (hoy `educacion_*`).

---

## Archivos clave

| Área | Path |
|------|------|
| Ingest Instant Forms | `api/src/leads/meta-leadgen.service.ts` |
| Rutas form→área | `api/src/leads/lead-form-area.util.ts` |
| Orígenes y contacto | `api/src/leads/leads.service.ts` |
| Chat hints | `api/src/leads/lead-origin.util.ts` |
| Links MALI ONE | `api/src/leads/mali-one-link-match.util.ts` |
| CTWA sync nombres | `api/src/meta-ads/meta-ads.service.ts` |
| TikTok ingest | `api/src/leads/tiktok-leadgen.service.ts` |
| UI forms | `web/src/features/leads/MetaFormsPage.tsx` |
| UI TikTok forms | `web/src/features/leads/TikTokFormsPage.tsx` |
| UI CTWA | `web/src/features/meta-ads/*` |
| Display orígenes | `web/src/features/leads/originDisplay.ts` |
