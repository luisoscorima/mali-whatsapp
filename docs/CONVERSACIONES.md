# Conversaciones

Inbox operativo: un hilo por **contacto + línea**. No es el dueño del ciclo de lead ni de la ficha.

Histórico: [CONVERSACIONES-CHANGELOG.md](./CONVERSACIONES-CHANGELOG.md). Relacionado: [LINEAS.md](./LINEAS.md), [CONTACTOS.md](./CONTACTOS.md), [LEADS.md](./LEADS.md), [IA-AJUSTES.md](./IA-AJUSTES.md).

## Modelo

| Pieza | Regla |
|-------|--------|
| Clave | Conversación por línea (`whatsapp_line_id`); no se fusionan entre sí |
| Persona | Vinculada a la ficha/persona; varias líneas ⇒ varios hilos |
| Ficha del área | `contact_id` debe ser ficha del **mismo área** que el chat. Inbound y apertura de detalle aseguran/crean esa ficha vía `PersonResolver` |
| Segmentos en cabecera | Solo de la ficha del área del chat. Si la persona tiene fichas en otras áreas, nota: “También tiene ficha en: …” (sin chips ajenos) |
| Asesor del chat | Asignación en el hilo | Cubrir el inbox **no** transfiere la venta ni la comisión |
| Asesor comercial | Ownership del **ciclo** ([LEADS.md](./LEADS.md)) | Dato distinto del responsable del chat; reasignar oportunidad puede *solicitar* cambio de chat |
| Pago ↔ ciclo | Chip en header/ficha si hay `payment_link` | Proxy [PAYMENT-LOOKUP-WA.md](./PAYMENT-LOOKUP-WA.md); no es columna del inbox |
| Modo | `bot` (IA si el área tiene bot) / `human` |

## Pantallas

- `/conversations` · `/conversations/:id` — lista + hilo
- Filtros: asignado / sin asignar, búsqueda, chips de segmento y anuncio
- Acciones: asignar, enviar plantilla (`templates.send_from_chat`), programar mensaje, notas rápidas, marcar no leído, adjuntos/descarga, export (permiso), bot ↔ humano

## Composer (`InboxComposeBar`)

Barra de respuesta del hilo (texto, adjuntos, nota de voz, programar, notas rápidas).

| Pieza | Regla |
|-------|--------|
| Primario | Vacío → micrófono (grabar); con texto/adjunto/voz → enviar; al enviar → “…” |
| Formato | Negrita (`*`) y cursiva (`_`) con Toggle shadcn; estado `pressed` según selección |
| Nota de voz | Grabar → detener (stop) o enviar directo → preview con player → enviar o descartar |
| Motion | Solo opacidad, corto: swap mic↔enviar, pulse del punto al grabar, fade in/out de grabación/preview/stop. Respeta `prefers-reduced-motion` |

## Ventana y medios

- Respuestas libres / IA: ventana de **24 h** desde el último inbound (reglas Meta).
- CTWA / botón FB: ventana de servicio extendida (72 h) en pricing Meta; ver [META-WABA.md](./META-WABA.md).
- Estados `scheduled` / `sent` / `delivered` / `read` / `failed` (programados y webhook).
- Descarga: `GET /conversations/:conversationId/messages/:messageId/download`.

## Mensajes programados

Envío diferido desde el composer (misma carga que reply: texto y/o adjunto; no plantillas). Requiere ventana 24 h abierta al programar. Zona horaria UI: `America/Lima`.

| Pieza | Regla |
|-------|--------|
| UI | Reloj visible solo con texto/adjunto → modal fecha/hora (default: mañana 08:00) |
| Persistencia | `chat_messages` outbound con `raw_payload.status = scheduled` + `scheduled_at` |
| Cola | BullMQ `outbound` con `delay`; al vencer → `pending` y Graph. Si la ventana ya cerró → `failed` |
| Burbuja | Etiqueta “Programado para…” mientras esté pendiente; al enviar, estado normal de entrega |
| Timeline | Evento `conversation.message_scheduled`: “Mensaje programado para 26 nov 8:00 am - Ver” |
| Ver / cancelar | Modal con pendientes; cancelar borra mensaje + job (el evento de timeline permanece) |

API:

- `POST /conversations/:id/schedule` — body como reply + `scheduled_at` (ISO futuro, mín. +1 min)
- `GET /conversations/:id/scheduled-messages`
- `DELETE /conversations/:id/scheduled-messages/:messageId`

## Fuera de horario

Mensaje automático configurable por área cuando no hay atención humana ([IA-AJUSTES.md](./IA-AJUSTES.md)).
