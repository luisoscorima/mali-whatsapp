# Consumidores de la CRM API (inventario F0)

Inventario ligero de quién llama a mali-whatsapp `/api/crm/*` (token `X-Crm-Service-Token`). No es un refactor: solo mapa para el cutover.

## Externos (MALI ONE)

| Consumidor | Rutas típicas | Uso |
|------------|---------------|-----|
| `whatsapp-crm-client.service.ts` | `POST /origins`, `POST /sync`, contacts/leads/cycles/management, prospectia, statuses, manual lead | CRM Educación + widget Educación + PAM |
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
