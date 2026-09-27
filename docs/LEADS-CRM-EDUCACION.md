# Leads Educación — CRM (reemplazo del Sheet BBDD)

Decisión de producto: cómo reemplazar el Apps Script / Google Sheets **BBDD 2026 EP** (“Filtrador de Leads”) sin duplicar un CRM de prospectos.

Relacionado: [OWNERSHIP-LEADS.md](./OWNERSHIP-LEADS.md), [LEADS-ESTADO.md](./LEADS-ESTADO.md), [CRM-API.md](./CRM-API.md), [MODELO-WABA-AREAS.md](./MODELO-WABA-AREAS.md).

---

## Decisión

| Pieza | Dónde | Rol |
|-------|--------|-----|
| **Fuente de verdad** | mali-whatsapp | Persona, orígenes, `lead_status`, ownership/asignación, regla de recontacto, historial |
| **Vitrina operativa** | MALI ONE (CRM Educación) | UI para asesoras/jefes: listar, verificar, asignar, reportar — consume la CRM API de WhatsApp |
| **Captura web** | MALI ONE | Widget → `EducacionLead` → sync a WhatsApp (`channel=widget`) |
| **Chat / campañas WA** | mali-whatsapp | Inbox, plantillas, asignación de conversación |

**ONE no mantiene una BD paralela de leads** (no “Condensado” ni hojas por asesora en ONE). Mismo patrón que CRM PAM: panel en ONE, persona en WhatsApp.

WhatsApp **reemplaza el Excel**. ONE es la **vitrina** para gestionar; no un segundo CRM de prospectos.

---

## Qué hacía el Sheet (referencia)

Menú Apps Script sobre hojas `Subir leads` → `Condensado` → hojas por asesora (DHAYANIS, VALENTINA, …):

1. **Verificar números** — busca teléfono en bases; la regla operativa vigente usa 60 días exactos desde la última interacción válida.
2. **Copiar al Condensado** — staging → BD operativa (campaña fija tipo `C7`).
3. **Distribuir a asesores** — copia a hoja de asesora + fórmulas enlazadas + email.
4. **Alertas** — leads con asesor y estado vacío +N días.
5. **Reportes** — semanal / mensual / anual / por fechas, **agrupados por fuente** (no por asesora), email a jefes.
6. **Historial** de distribuciones.

Acceso restringido a correos de jefatura; notificaciones por Gmail.

---

## Qué ya existe en Mali (base)

| Capacidad Sheet | En WhatsApp hoy |
|-----------------|-----------------|
| Ingest / “Subir leads” | Instant Form, CTWA, TikTok, widget, links MALI ONE y WhatsApp orgánico → `contact_origins` |
| Identidad | Match por BSUID → teléfono → DNI → email, dentro del área |
| Condensado (BD central) | `contacts` + `contact_origins` + `education_lead_entries` + `education_lead_cycles` |
| Acceso | Roles / `leads.list` |
| Fuente / curso | Payload del origen + export |
| UI captura Meta | `/leads`, `/leads/meta-forms`, `/leads/meta-ctwa` |

**Actualizado:** CRM Educación gestiona un asesor por ciclo de lead (`education_lead_cycles.assigned_user_id`) y refleja la asignación en el chat. Cada mensaje sigue identificado por su remitente. Los estados siguen siendo CRM genéricos; la taxonomía del Sheet requiere alineación.

El detalle de captación, enlace de contacto, Prospectia y clasificación está en la sección siguiente. Setup Meta y TikTok: [LEADS-ESTADO.md](./LEADS-ESTADO.md). Contrato HTTP: [CRM-API.md](./CRM-API.md).

---

## Flujo de captación (implementado)

Solo entran a este CRM las áreas `educacion`, `educacion_ca` y `educacion_ep`. Un origen de otra área (el widget sin área cae en `ti`) queda en contactos y orígenes, y no se consulta en Prospectia ni se clasifica aquí.

```text
Conector o inbound de WhatsApp
        ↓
Contacto (crear o enlazar) + contact_origins
        ↓
Si el área es de educación → education_lead_entries (+ ciclo si corresponde)
        ↓
Consulta a Prospectia sobre esa entrada (si cae, la entrada ya quedó)
        ↓
CRM Educación en MALI ONE: reparto, reasignación, conflictos
```

La clasificación de 60 días ocurre al crear la entrada, no en un paso posterior.

### Orígenes

| Canal | Cuándo se registra | Área |
|-------|--------------------|------|
| `meta_lead_form` | Webhook Lead Ads o backfill | Nombre del formulario: Cursos de Arte / `[FORM CA]` → CA; `[FORM EP]` → EP; resto → Educación. Override manual con `area_locked`. |
| `tiktok` | Webhook o backfill de Instant Form | La misma regla de nombre que Meta. |
| `meta_ctwa` | Inbound de WhatsApp con `referral` | Línea (`phone_number_id`), como el resto del chat. |
| `widget` | MALI ONE hace `POST /crm/origins` | La que envíe el body. Si no viene, `ti` (no entra a este CRM). |
| `mali_one_link` | Primer mensaje sin anuncio CTWA, si el texto encaja con el catálogo de links de MALI ONE | La línea de WhatsApp. |
| `organic_wa` | Inbound en una de las tres áreas, solo si ese contacto o esa conversación no tienen ya otro origen | La línea de WhatsApp. |
| `import` | Reservado para cargar los históricos del Sheet. `POST /crm/origins` lo acepta; aún no hay pantalla. | La que envíe el body. |
| `other` | Mismo endpoint. No hay conector. Respaldo si llega un canal que la UI no nombra. | La que envíe el body. |

Un Instant Form y un CTWA de la misma persona no son dos CRMs: son dos orígenes del mismo contacto si la identidad coincide.

`mali_one_link` se atribuye al enviar el WhatsApp prellenado, no al hacer clic en el acortador. El cuerpo debe terminar en `ref:{slug}`, o el texto normalizado (mínimo 12 caracteres) debe coincidir con el catálogo. Si varios links comparten el mismo texto, se toma el más exacto y se marca ambiguo. Si el catálogo no responde, el match por texto no corre. Un mensaje con `referral` de anuncio no se evalúa como link.

### Conversación o solo contacto

`came_with_inbound` marca cómo se captó el origen. No bifurca el CRM.

| Canal | Cuenta como conversación |
|-------|--------------------------|
| `meta_ctwa`, `organic_wa`, `mali_one_link` | Si el origen tiene `conversation_id` |
| `widget` | Si el chat resuelto ya tiene un mensaje inbound del lead |
| `meta_lead_form`, `tiktok`, `import`, `other` | Nunca. Un chat posterior no cambia la marca |

### Enlace con el contacto

El match es por área: identidad de WhatsApp (BSUID), teléfono, DNI y email, en ese orden.

Si el contacto ya existe, se conservan los datos que ya tiene y se rellenan los huecos (teléfono, BSUID, DNI, email, apellido). Instant Form de Meta y TikTok son la excepción: reemplazan el nombre, y el apellido si el formulario lo trae, para no dejar el alias de WhatsApp que a veces quedó de un CTWA.

Si no existe, se crea con los datos del lead. En WhatsApp el nombre es el perfil (`wa_profile_name`). Si no hay nombre, se guarda vacío para que Chats use perfil o teléfono. Un nombre guardado como el placeholder `Lead` se reemplaza.

### Orgánico y la sesión de 24 horas

El orgánico no es “cualquier lead sin payload”. Si el contacto o la conversación ya tienen un Instant Form, un CTWA, un widget o un link MALI ONE:

- no se crea un origen `organic_wa`;
- si esa atribución se vio en las últimas 24 horas, el inbound se registra con el canal de esa atribución;
- si es más vieja, la entrada de educación se guarda como `organic_wa` sin abrir otra fila de origen.

Los mensajes de la misma conversación dentro de 24 horas, o una entrada de educación del mismo contacto en esa ventana, no generan otra entrada. Solo mueven `last_interaction_at`, salvo que la entrada vigente sea un conflicto.

### Prospectia

La consulta ocurre después de persistir la entrada de educación, no antes. Busca por teléfono, usuario de WhatsApp o BSUID.

Si no hay token, la API no responde o la búsqueda es ambigua, el match queda `unverified` y el flujo de leads sigue. La entrada ya está guardada.

El asesor de Prospectia se copia al ciclo solo si se cumplen todas estas condiciones:

- el match es único y la búsqueda no vino truncada;
- allá hay una conversación abierta o pendiente con email de asesor;
- ese email es un usuario provisionado del área;
- el ciclo de Mali no tiene asesor y no está marcado para revisión (`requires_review`).

Un ciclo que ya trae asesor, o un regreso de más de 60 días (queda en revisión y conserva al asesor anterior), no se reasigna solo por Prospectia.

Al arrancar la API se reconsulta lo que nunca se marcó (`prospectia_checked_at` nulo). `POST /api/crm/education/prospectia/sync` relanza la pasada sobre todas las entradas; `GET` del mismo path devuelve el avance.

### Clasificación en el CRM

Cada entrada de las tres áreas se compara con el ciclo previo de ese contacto en esa área:

| Situación | Clasificación | Qué pasa con el asesor |
|-----------|---------------|------------------------|
| Sin historial | `new` / `new_number` | Sin asesor. El reparto automático (`POST /api/crm/education/distribute`) lo asigna por carga entre `asesor_comercial` del área. |
| Última interacción hace 60 días o menos | `duplicate` / `same_advisor` | Sigue el mismo ciclo. Se actualiza la fecha de interacción. |
| Última interacción hace más de 60 días | `new` / `reassignable` | Ciclo nuevo. Conserva al asesor anterior hasta que alguien lo confirme o lo cambie. El estado del contacto vuelve al default. `requires_review`. |
| Estado `convertido` o `venta_exitosa` | `conflict` | No se abre ciclo solo. Revisión manual. |
| Estado `no_interesado` y última interacción dentro de 60 días | `conflict` | Igual. |

Un mensaje saliente no amplía la ventana de 60 días.

La revisión de un conflicto (`PATCH /api/crm/education/entries/:id/review`) acepta `open_new` (ciclo nuevo reasignable), `keep_existing` (se trata como duplicado del mismo asesor) o `dismiss`. `PATCH .../contacts/:id/management` cambia asesor o estado del ciclo actual; `assigned_user_id: null` se rechaza.

---

## Gaps para apagar el Sheet

El CRM Educación de MALI ONE ya ofrece una vista inicial de Contactos y Leads de los tres números. Pagos y Campañas siguen como «Próximamente». Este MVP no sustituye todavía el flujo diario del Sheet: faltan las capacidades operativas listadas abajo.

| Capacidad | Estado | Notas |
|-----------|--------|--------|
| Ownership del ciclo de lead | Implementado | Un asesor por ciclo; los ciclos futuros conservan estado y calificación. La migración no puede reconstruir snapshots antiguos. |
| Ventana de 60 días y clasificación | Implementado | Nuevos muestra todas las entradas del periodo; número nuevo, duplicado/mismo asesor, puede reasignarse y conflicto se distinguen por área de entrada |
| Distribuir números sin historial | Implementado | Solo teléfonos sin historial en ese número se reparten por carga reciente de ciclos abiertos; regresos de más de 60 días conservan al asesor anterior y requieren confirmarlo o cambiarlo directamente; auditoría en `audit_logs` |
| Reglas adicionales de conflicto | Pendiente | Primeras reglas: convertido/venta exitosa y no interesado reciente |
| Alerta sin gestionar (+N días) | Falta | Job o disparo desde ONE |
| Reportes por fuente + email | Falta | Datos en orígenes; envío: SES en ONE encaja bien |
| Infra email saliente en WA | No | Preferible SES desde ONE (como CRM PAM) |

---

## Lo que sigue fuera de este flujo

La captura, la clasificación y la asignación ya viven en WhatsApp (sección anterior). Siguen pendientes las alertas de leads sin gestionar y los reportes por fuente con email, descritos en los gaps.

No replicar pestañas “DHAYANIS / Condensado”. Un contacto puede tener varios ciclos históricos; solo el ciclo actual tiene un asesor responsable vigente. La vitrina es CRM Educación en MALI ONE; el chat y las campañas siguen en el inbox de WhatsApp.

---

## Dónde implementar cada pieza

| Capacidad | Implementar en |
|-----------|----------------|
| Verificar teléfono / regla recontacto | API WhatsApp |
| Asignar asesora / historial distribución | API WhatsApp |
| Estados / catálogo EP (o mapeo) | WhatsApp (`lead_status_definitions`) |
| Alertas “sin gestionar” | Job WhatsApp **o** ONE llamando WA |
| Reportes por fuente × periodo + email | **ONE** (UI + SES); agregación vía CRM API / export WA |
| Pantalla diaria asesoras/jefes | **CRM Educación en MALI ONE** |
| Hub técnico Meta (forms, routes, backfill) | WhatsApp `/leads` (operación producto) |

---

## Fases sugeridas

### Fase 1 — Mínimo para dejar de depender del Sheet

1. Ciclos con `assigned_user_id` y entradas con clasificación — implementado.
2. Ventana exacta de 60 días, filtro de duplicados/conflictos y revisión manual — implementado para reglas iniciales.
3. Asignación equitativa en lote de números sin historial y sin asesor — implementado; los regresos de más de 60 días requieren decisión humana.
4. Alinear o mapear estados EP del Sheet al catálogo del área — pendiente.

Consumible desde WhatsApp `/leads`; la vitrina ONE muestra contactos y entradas, y permite asignar y revisar los casos iniciales. Quedan pendientes reglas adicionales y reportes.

### Fase 2 — Operación completa

1. Ampliar CRM Educación en ONE con reglas adicionales de conflicto, alertas y detalle operativo vía [CRM-API](./CRM-API.md).
2. Reportes por fuente (semana / mes / año / rango) + email SES a jefes/asesoras.
3. Cron alerta sin gestionar.
4. Apagar espejo Sheet (`EDUCACION_LEADS_SHEETS_ENABLED=false` en ONE) y el Apps Script BBDD cuando el flujo diario ya no lo use.

---

## Qué no hacer

- Recrear en ONE otra BD de leads tipo Condensado + hojas por asesora.
- Tratar CTWA e Instant Form como CRMs distintos (son orígenes del mismo contacto).
- Poner la fuente de verdad de asignación solo en conversaciones: el lead debe tener ownership aunque aún no haya chat.
- Un cliente API distinto por línea WA; el tenant es el **área de negocio** (hoy `educacion_*`; ver [MODELO-WABA-AREAS.md](./MODELO-WABA-AREAS.md)).

---

## Resumen en una frase

**WhatsApp guarda y decide; MALI ONE muestra y opera** (CRM Educación como vitrina). El Sheet BBDD EP se apaga cuando verificar → asignar → alertar → reportar por fuente viva sobre contactos/orígenes de WhatsApp.
