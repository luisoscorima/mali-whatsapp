# IA y ajustes

Respuesta automática (Groq), bot por área, fuera de horario y flags de settings.

Histórico: [IA-AJUSTES-CHANGELOG.md](./IA-AJUSTES-CHANGELOG.md). Relacionado: [CONVERSACIONES.md](./CONVERSACIONES.md), [AREAS.md](./AREAS.md).

## IA (Groq)

- Motor: API compatible OpenAI de **Groq** (`llama-3.1-8b-instant`), `GROQ_API_KEY`.
- Sin clave: se guardan mensajes; no hay respuesta automática.
- Modo conversación: `bot` (IA si el área tiene bot habilitado) / `human` (solo equipo).
- Master activa/desactiva bot por área: Ajustes → IA (`PATCH /api/settings/ai/:area`, `POST .../enable`).
- Contexto: últimos turnos del hilo. Transferencia a humano: palabra clave (default `[TRANSFERIR]`); si la IA falla, puede pasar a asesor con cortesía.
- Solo responde en ventana de 24 h Meta cuando aplica.

## Fuera de horario

Mensaje automático configurable por área (`/settings/fuera-de-horario`) cuando no hay atención humana.

## Otras rutas de ajustes

| Ruta | Contenido |
|------|-----------|
| `/settings/integracion` | Punteros a Meta / deploy |
| `/settings/ia` | Bot por área |
| `/settings/fuera-de-horario` | Mensaje horario |
| `/settings/bitacora` | Auditoría (ver [REPORTERIA.md](./REPORTERIA.md)) |
| `/settings/reporteria` | Informes operativos |
