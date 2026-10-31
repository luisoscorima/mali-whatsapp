# Líneas

Número de WhatsApp Cloud API. Varias por área (y por categoría en Educación). La **conversación es una por línea**.

Histórico: [LINEAS-CHANGELOG.md](./LINEAS-CHANGELOG.md). Relacionado: [AREAS.md](./AREAS.md), [CATEGORIAS.md](./CATEGORIAS.md), [META-WABA.md](./META-WABA.md), [CONVERSACIONES.md](./CONVERSACIONES.md).

## Modelo

| Pieza | Tabla | Rol |
|-------|--------|-----|
| **Línea** | `whatsapp_lines` | Phone Number ID, área, programa opcional, token propio o heredado |
| **WABA** | `whatsapp_wabas` | Cuenta Meta: plantillas, `subscribed_apps`, token compartido. **No** es el tenant |

```text
WABA ──┐
       ├── Línea (PID) → Área (+ categoría)
Conversación → Línea + Persona
```

## Alta operativa

Pantalla master: **Admin → Líneas / WhatsApp** (`/admin/whatsapp`).

Orden: **crear (borrador) → Validar en Meta → Activar**.

1. Elegir WABA (y token compartido o token de línea).
2. Crear borrador con área canónica y categoría opcional.
3. Validar PID contra Meta (fallo = no se puede activar; no pisa otros tokens).
4. Activar. Inbound/respuesta sin reiniciar contenedores. Réplicas refrescan catálogo (~15 s).
5. Desactivar: deja de enrutar; un PID desactivado no revive por fallback `.env`.

Cambiar nombre visible no altera la identidad de las conversaciones. Cambiar categoría solo mueve el programa. Elegir línea predeterminada del área es transaccional; los chats existentes siguen respondiendo por su propio PID.

## Envío y campañas

- Respuesta de chat: sale por la **línea de esa conversación**.
- Campaña: elige una línea de las categorías de su audiencia. Si trae categorías y no trae línea → API rechaza. Sin filtro de categoría → línea predeterminada del área.

## Credenciales

Prioridad: bóveda / Admin Meta (cifrada con `WHATSAPP_CREDENTIALS_MASTER_KEY`) sobre `WHATSAPP_TOKEN_*` / `PHONE_NUMBER_ID_*` del `.env`. Catálogo dinámico: `WHATSAPP_LINE_CATALOG_ENABLED`.

Detalle de Graph, webhook y `subscribed_apps`: [META-WABA.md](./META-WABA.md).
