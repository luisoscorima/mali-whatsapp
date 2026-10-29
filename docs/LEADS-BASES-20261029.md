# Bases Lead/Contacto — cierre operativo 29 oct 2026

## Objetivo

Dejar el modelo Lead vs Contacto **enforceable** en producción para la siguiente fase (MALI ONE), sin activar aún el comportamiento de piloto (`leads.attention_v1`).

## Qué se hizo en producción

1. Deploy `d5fe33d` + migración `20261028120000_leads_additive_lifecycle` (ya aplicada).
2. Dry-run de resolución de 188 grupos competidores (`leads-conflicts-propose.cjs`).
3. **Apply** del lote con reglas de producto (ver abajo).
4. Creación de índices únicos diferidos (`deferred_open_unique.sql`).
5. Flag `leads.attention_v1` **sigue ausente / apagado**.

Artefactos en el servidor: `~/mali-whatsapp/backups/leads-conflicts-propose-20261029/` y `~/mali-whatsapp/backups/leads-conflicts-apply-*`.

## Reglas de resolución aplicadas

- **Asesor:** conservar el ciclo con el asesor asignado más reciente (`first_assigned_at`, si no `last_interaction_at`). Sin asignar pierde frente a asignado. Si ambos sin asignar → el de interacción más reciente.
- **Estado:** en el ciclo conservado, tomar el último `lead_status_id` no vacío del grupo; si ninguno tiene, puede quedar vacío.
- **Perdedores:** `closed_at = now`, `close_reason = superseded_duplicate`, vínculos vivos de conversación con `unlinked_at`.
- **Conflictos:** `education_lead_open_conflicts.resolved_at` marcado.
- **Históricos ~3.748** (>60 días sin deadline): **no** se tocaron; se dejan abiertos para cierre manual futuro.

## Qué significa el candado (índices)

Tras `deferred_open_unique.sql`:

- A lo sumo **un** ciclo con `closed_at IS NULL` por `(person_id, business_area_id, program_id)`.
- General (`program_id` null): índice parcial aparte.

Sin ese candado, MALI ONE podría crear/asumir duplicados abiertos. Con él, la BD rechaza un segundo abierto.

## Qué es el flag (aún no)

`app_settings`: `area=educacion`, `key=leads.attention_v1`, `value=1`.

Enciende: alertas de nuevo lead, claim de lead antes de enviar, CTA “iniciar atención”, expire automático de ciclos **con** `inactivity_deadline_at`.

**No activar** hasta smoke de negocio / fase piloto. El modelo ya está sentado con flag apagado.

## Scripts

| Script | Uso |
|--------|-----|
| `leads-conflicts-propose.cjs` | Dry-run; `--apply` + `ALLOW_APPLY=1` escribe |
| `deferred_open_unique.sql` | Índices únicos (solo con 0 duplicados abiertos) |
| `leads-prod-smoke-readonly.sh` | Smoke lectura prod |
| `leads-expire-historical-candidates.cjs` | Lista 60d sin deadline (no auto) |

## Para MALI ONE (siguiente fase)

- Consumir ciclos abiertos / atención por persona+categoría.
- UI de conflictos/supervisor puede vivir allí; la unicidad ya la garantiza la BD.
- Prospectia: sin cambio hasta decisión explícita.
- No backfillear alertas históricas masivas.
