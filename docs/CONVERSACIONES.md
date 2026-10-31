# Conversaciones

Inbox operativo: un hilo por **contacto + línea**. No es el dueño del ciclo de lead ni de la ficha.

Histórico: [CONVERSACIONES-CHANGELOG.md](./CONVERSACIONES-CHANGELOG.md). Relacionado: [LINEAS.md](./LINEAS.md), [CONTACTOS.md](./CONTACTOS.md), [LEADS.md](./LEADS.md), [IA-AJUSTES.md](./IA-AJUSTES.md).

## Modelo

| Pieza | Regla |
|-------|--------|
| Clave | Conversación por línea (`whatsapp_line_id`); no se fusionan entre sí |
| Persona | Vinculada a la ficha/persona; varias líneas ⇒ varios hilos |
| Asesor | Asignación en el hilo; el **ownership de lead** vive en el ciclo ([LEADS.md](./LEADS.md)) |
| Modo | `bot` (IA si el área tiene bot) / `human` |

## Pantallas

- `/conversations` · `/conversations/:id` — lista + hilo
- Filtros: asignado / sin asignar, búsqueda, chips de segmento y anuncio
- Acciones: asignar, enviar plantilla (`templates.send_from_chat`), marcar no leído, adjuntos/descarga, export (permiso), bot ↔ humano

## Ventana y medios

- Respuestas libres / IA: ventana de **24 h** desde el último inbound (reglas Meta).
- CTWA / botón FB: ventana de servicio extendida (72 h) en pricing Meta; ver [META-WABA.md](./META-WABA.md).
- Estados `sent` / `delivered` / `read` / `failed` por webhook.
- Descarga: `GET /conversations/:conversationId/messages/:messageId/download`.

## Fuera de horario

Mensaje automático configurable por área cuando no hay atención humana ([IA-AJUSTES.md](./IA-AJUSTES.md)).
