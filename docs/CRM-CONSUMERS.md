# Consumidores de la CRM API (inventario F0)

Inventario ligero de quién llama a mali-whatsapp `/api/crm/*` (token `X-Crm-Service-Token`). No es un refactor: solo mapa para el cutover.

## Externos (MALI ONE)

| Consumidor | Rutas típicas | Uso |
|------------|---------------|-----|
| `whatsapp-crm-client.service.ts` | `POST /origins`, `POST /sync`, contacts/leads/cycles/management, statuses, manual lead | CRM Educación + widget Educación + PAM |
| `mali-one-opportunity-link.service.ts` | `POST /api/crm-educacion/internal/opportunities/link-cycle` | Vincula ciclo WA → oportunidad nativa ONE (p.ej. Prospectia); retry corto |
| `mali-one-channel-event.service.ts` | `POST /api/crm-educacion/internal/channel-events` | Outbox shadow management (etapa/assign/cierre); no dual-write |
| Widget Educación → `EducacionLead` | `POST /origins` (`channel=widget`) | Buffer local + sync |
| CRM PAM | `POST /sync`, contacts, audience, send-template | Membresías |
| Catálogo Educación (estados) | `GET/POST/PATCH education/statuses` | Espejo de estados |

## Internos (mismo monorepo)

| Consumidor | Uso |
|------------|-----|
| Inbox / `conversations.service` | Asignación chat; proyección desde ciclo |
| `education-lead-workflow` | Motor de ciclos (no vía HTTP CRM; Prisma local) |
| Webhooks Meta/TikTok | Ingesta → leads/origins (no token CRM) |

## Identidad

- Personas/fichas: hoy en WA (`people` / `contacts`).
- PAM y Educación comparten resolución de persona en WA.
- Post-cutover: maestro comercial en ONE; WA conserva contacto operativo del canal.

## Regla de frontera

- Escrituras comerciales del asesor en destino: UI WA → API ONE (tras cutover).
- Hoy: UI WA y UI ONE (jefes) escriben al motor WA.
- No dual-write de oportunidades.
- Educación: estado/score/asignación comercial viven en el **ciclo** (categoría/línea), nunca en `contacts.lead_*`.
- Vínculo pago↔ciclo: `EducacionSale` en ONE; WA solo proxy (`/api/leads/payments/*`). Detalle: [PAYMENT-LOOKUP-WA.md](./PAYMENT-LOOKUP-WA.md).
# Entrega shadow durable (consolidación ventana 6h)

La migración `20261120010000_cycle_shadow_outbox_trigger` añade un trigger de
INSERT/UPDATE de ciclos. Encola cambios reales de etapa, asesor y cierre en la
misma transacción, incluidos inbox, distribución, pagos y vencimiento. No hace
backfill ni modifica ciclos existentes. El historial de actor permanece en audit_logs.

`MaliOneChannelEventService` entrega hasta 25 pendientes cada 30 segundos; si
ONE falla conserva filas, registra intentos y reintenta después del reinicio.
ONE deduplica por event_id sin reemplazar el hecho original. No se eliminan filas
entregadas, ni se escribe etapa/asignación en ONE. Authority sigue WA.

El vínculo de ciclo envía categoría y ONE conserva vínculos existentes; coincidencias
ambiguas quedan sin enlazar. No sustituye otro ciclo ni modifica precio, etapa o asesor.

El seed de roles operativos requiere `APPLY_OPERATIONAL_ROLE_SEED=true` explícito.
No habilitarlo en despliegues ordinarios: restablece roles y membresías de áreas.
