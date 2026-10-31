# Plantillas

Plantillas WhatsApp (Graph) usadas en campañas y envío desde el chat.

Histórico: [PLANTILLAS-CHANGELOG.md](./PLANTILLAS-CHANGELOG.md). Relacionado: [META-WABA.md](./META-WABA.md), [CAMPANAS.md](./CAMPANAS.md), [CONVERSACIONES.md](./CONVERSACIONES.md).

## Alcance

- Scope por **WABA** (no por área aislada): sync `GET message_templates`.
- Estados: `PENDING` / `APPROVED` / `REJECTED` (webhook `message_template_status_update`).
- Solo **APPROVED** (y activas en producto) en selectores de envío.

Pantallas: `/templates`, `/templates/new`, `/templates/:id`. Crear desde app envía a revisión Meta.

## Variables y media

Cabeceras (media), cuerpo `{{1}}`…, botones URL. En campaña cada variable puede ser fija o por contacto. Definición: `GET /api/templates/:id/definition`.

Token necesita `whatsapp_business_management`. Si falla resolución WABA: `WABA_ID_*` por línea/área.

## Desde el chat

Permiso `templates.send_from_chat`: listar aprobadas/activas y enviar sin abrir el módulo Plantillas (`templates.list`).

## Errores frecuentes Meta

`132001` plantilla/idioma · `132000` parámetros · `131030` sandbox número no permitido. Detalle: [META-WABA.md](./META-WABA.md).
