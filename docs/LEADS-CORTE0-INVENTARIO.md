# Corte 0 — Inventario ligero (Educación)

Fecha: 2026-10-28. Piloto: áreas `educacion` / `educacion_ca` / `educacion_ep`.

## Escritores actuales

| Origen | Entrada | Abre/reutiliza ciclo | Notas |
|--------|---------|---------------------|-------|
| Meta Instant Form | `MetaLeadgenService` → `LeadsService.upsertOrigin` → `recordOrigin` | Sí | Idempotencia `(area, channel, external_id)` |
| Meta CTWA | webhook → origen + inbound | Sí | Ligado a conversación |
| TikTok | `TikTokLeadgenService` → `upsertOrigin` | Sí | |
| Widget / CRM | `POST /crm/origins` → `upsertOrigin` | Sí | Canal `widget` u otros |
| Links MALI ONE | origen `mali_one_link` | Sí | |
| WhatsApp orgánico | `recordEducationOrganicOrigin` + `recordInbound` | Sí (hoy) | Post-cierre: **no** auto-crear (regla piloto) |
| Prospectia | `applyProspectiaSnapshot` / sync | Asigna si ciclo libre y sin review | **Decisión pendiente**: conservar autoasignación vs solo sugerir |
| Bandeja | `ConversationsService.reply` / assign / `setLeadScore` | Claim / sync ciclo↔chat | Claim debe reservar **antes** del envío |
| CRM gestión | `updateManagement`, `distribute`, `reviewEntry` | Asigna / revisa conflictos | |

## Duplicados y contexto

- Ciclos hoy se clavean por `contact_id`, no por `person_id`.
- Varias fichas de la misma persona pueden abrir ciclos “activos” paralelos.
- Consultas de “último ciclo” a veces ignoran `program_id` (riesgo CA vs EP).
- `program_id = null` = General; unicidad abierta requiere índice parcial aparte.

## Marcaje de atributos (hoja de trabajo)

Clasificar cada `contact_attribute_definitions` de Educación como:

| Tipo | Criterio | Ejemplos esperados |
|------|----------|--------------------|
| `contact_shared` | Describe a la persona; debe ser único entre áreas | profesión, DNI proyectado, demografía estable |
| `contact_contextual` | Tiene sentido por área/categoría | segmento operativo, datos de línea |
| `lead` | Pertenece a la oportunidad | curso de esta consulta, convocatoria, objeción |

Regla de escritura de compartidos (producto cerrada; almacenamiento en Corte 3):

- Una sola operación de edición para `contact_shared`.
- Escribe en canónico y proyecta a fichas hermanas de la misma `person_id` (auditada).
- Dos áreas no pueden divergir el mismo slug compartido.

Propuesta de canónico hasta consolidar `people`: ficha Educación “primaria” de la persona (menor `contacts.id` activa del área canónica `educacion`) + proyección a hermanas; lectura unifica por `person_id`.

## Prospectia (pendiente)

Comportamiento actual: si hay email de asesor, ciclo libre y `requires_review=false`, asigna ciclo y conversaciones sin dueño.

Opciones a decidir antes de cambiar prod:

1. Conservar autoasignación (como hoy).
2. Solo sugerir (guardar snapshot; no asignar).
3. Híbrido: autoasignar solo `new_number` sin historial.

## Caducidad

Propuesta: 60 días de inactividad del interesado (continuidad con ventana actual). Confirmar con datos del piloto. Bots/campañas/edición de ficha no renuevan.

## Criterio de salida de este corte

- Mapa de escritores (arriba).
- Riesgo de duplicados person/categoría identificado.
- Hoja de atributos lista para marcar en admin/piloto.
- Nota Prospectia explícita como pendiente.
