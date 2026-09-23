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
| Ingest / “Subir leads” | Webhook Instant Forms, backfill, CTWA, widget ONE → `POST /crm/origins` |
| Identidad por teléfono | Match phone → dni → email por área |
| Condensado (BD central) | `contacts` + `contact_origins` + `education_lead_entries` + `education_lead_cycles` |
| Acceso | Roles / `leads.list` |
| Fuente / curso | Payload del origen + export |
| UI captura Meta | `/leads`, `/leads/meta-forms`, `/leads/meta-ctwa` |

**Actualizado:** CRM Educación gestiona un asesor por ciclo de lead (`education_lead_cycles.assigned_user_id`) y refleja la asignación en el chat. Cada mensaje sigue identificado por su remitente. Los estados siguen siendo CRM genéricos; la taxonomía del Sheet requiere alineación.

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

## Flujo objetivo (sin copiar hojas)

```text
Captura (Meta / widget / import)
        ↓
WhatsApp: contacto + origen + entrada + ciclo
        ↓
Cola / bandeja “por asignar”
        ↓
Clasificar por ventana de 60 días        ← API WhatsApp
        ↓
Asignar asesora (ownership del ciclo)   ← API WhatsApp
        ↓
UI CRM Educación (MALI ONE)             ← vitrina
        + reportes / emails (ONE + SES)
        + chat / campañas (WhatsApp inbox)
```

No replicar pestañas “DHAYANIS / Condensado”. Un contacto puede tener varios ciclos históricos; solo el ciclo actual tiene un asesor responsable vigente.

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
