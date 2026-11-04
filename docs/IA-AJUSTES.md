# IA y ajustes

Respuesta automática (Groq), bot por área, fuera de horario y flags de settings.

Histórico: [IA-AJUSTES-CHANGELOG.md](./IA-AJUSTES-CHANGELOG.md). Relacionado: [CONVERSACIONES.md](./CONVERSACIONES.md), [AREAS.md](./AREAS.md).

## IA (Groq)

- Motor: API compatible OpenAI de **Groq** (`llama-3.1-8b-instant`), `GROQ_API_KEY`.
- Sin clave: se guardan mensajes; no hay respuesta automática.
- Modo conversación: `bot` (IA si el área tiene bot habilitado) / `human` (solo equipo).
- Master activa/desactiva bot por área: Ajustes → Respuesta automática (IA) (`PATCH /api/settings/ai/:area`, `POST .../enable`).
- Contexto: últimos turnos del hilo. Transferencia a humano: palabra clave (default `[TRANSFERIR]`); si la IA falla, puede pasar a asesor con cortesía.
- Solo responde en ventana de 24 h Meta cuando aplica.

## Fuera de horario

Mensaje automático configurable por área (`/settings/fuera-de-horario`) cuando no hay atención humana.

## Rutas de Ajustes (configuración)

| Ruta | Contenido |
|------|-----------|
| `/settings/integracion` | Punteros a Meta / deploy |
| `/settings/ia` | Bot por área |
| `/settings/fuera-de-horario` | Mensaje horario |
| `/settings/sla` | SLA primera respuesta Educación (meta + horario hábil) |

Bitácora y reportería están en **Reportes** (`/reports/bitacora`, `/reports/reporteria`); ver [REPORTERIA.md](./REPORTERIA.md).

### SLA primera respuesta

Editable en Ajustes (Educación / master). Default: **10 min** hábiles; horario L–V 08:30–20:00, sáb 08:30–18:00, dom 09:00–18:00 (America/Lima). Independiente de Fuera de horario. Detalle operativo: [LEADS.md](./LEADS.md).
