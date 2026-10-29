# Piloto Educación — activación

## Feature flag

Clave en `app_settings`:

- `area=educacion`
- `key=leads.attention_v1`
- `value=1` para activar

Sin el flag:

- no alertas de nuevo lead, no atributos owner=`lead` en ciclo, no claim de lead
- `POST /api/leads/attention/start` error; `expireDueCycles` no cierra
- no segundo ciclo concurrente (reutiliza el abierto)

## Decisiones cerradas (2026-10-29)

1. **Caducidad** — Auto 60 días solo para ciclos con `inactivity_deadline_at` (escritores post-activación). Históricos quedan con deadline `NULL` tras la migración; los ~3.747 son candidatos de un **lote separado** (`leads-expire-historical-candidates.cjs`), revisable antes de `--apply` (`close_reason=historical_expire_batch`). Una interacción posterior a la activación puede fijar deadline y entrar al job automático.
2. **Conflictos** — Contar con criterio **null-aware** (“sin asesor” ≠ asignado). En el ensayo: **123** grupos manuales y **65** candidatos a validar (188 únicos). Misma gestión + cronología clara + sin actividad independiente → candidato; **nunca** cierre automático. Distintos asesores/estados (incl. nulos), actividad independiente o cronología ambigua → manual. Todo cierre conserva historial + `close_reason`.
3. **Prospectia** — Comportamiento actual hasta decisión explícita.
4. **Alertas** — Sin backfill masivo de históricos; script diagnóstico por defecto (`--alerts` opt-in).

## Copia aislada (siguiente paso)

Preparar réplica de prod **sin** workers, colas de envío, Meta/TikTok webhooks activos ni jobs de expire/campaign.

En la copia:

1. Desplegar / apuntar el **último código** (fixes P1/P2 + scripts).
2. `npx prisma migrate deploy` (`20261028120000_leads_additive_lifecycle`).
3. `node api/scripts/leads-backfill-lifecycle.cjs` (solo diagnóstico).
4. `node api/scripts/leads-conflicts-export.cjs > conflicts.json` — verificar `unique_groups`, `manual`, solapes.
5. Resolver conflictos (aplicar propuestas revisadas + cola manual); historial intacto.
6. Confirmar `education_lead_open_conflicts` sin pendientes → `psql … -f deferred_open_unique.sql` y verificar índices.
7. `node api/scripts/leads-expire-historical-candidates.cjs` — revisar muestra; no `--apply` en prod sin OK.
8. Validar comportamiento con flag aún en `0`: orgánico post-cierre, claim clásico, sin alertas nuevas.
9. Solo entonces: flag `1` en piloto y smoke (claim, alertas, CTA, CRM cycles).

## Estado prod (2026-10-29)

- Migración aplicada; binario en prod `a719065` (lifecycle + `education_lead_open_conflicts`).
- 188 conflictos resueltos con lote documentado (`docs/LEADS-BASES-20261029.md`); índices únicos **instalados**.
- Smoke readonly pre-activación: OK (conflictos 0, índices presentes, health OK, flag ausente).
- **Flag activado** con autorización explícita: `educacion` / `leads.attention_v1` = `1` a las **2026-10-29 15:06:43 UTC**.
- Smoke readonly post-activación: flag `1`, health OK, conflictos 0, alertas 0, `auto_expire_due` 0, ~3.564 históricos 60d sin deadline (sin tocar).
- Históricos 60d: siguen abiertos a propósito.

## Pendiente tras el encendido

1. Smoke de negocio en piloto (claim de lead, alerta en lead nuevo, CTA “Iniciar atención”, CRM `GET /crm/education/cycles`).
2. Lote histórico de vencimiento: opcional / manual; no urgente.
3. Prospectia: sin cambio hasta decisión explícita.

## Scripts

| Script | Rol |
|--------|-----|
| `leads-backfill-lifecycle.cjs` | Diagnóstico; `--alerts` opt-in |
| `leads-conflicts-export.cjs` | Grupos únicos + propuesta (nunca cierra) |
| `leads-expire-historical-candidates.cjs` | Candidatos 60d sin deadline; `--apply` explícito |
| `deferred_open_unique.sql` | Índices únicos abiertos tras conflictos = 0 |

## Reversión

1. `leads.attention_v1=0`
2. Conservar columnas aditivas
3. No desplegar binario antiguo si ya hay filas con `closed_at` / `person_id`
