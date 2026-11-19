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

Pantalla master: **Administración → Líneas** (`/admin/lines`).

Orden: **crear o sincronizar (borrador) → Registrar Cloud API → Activar**.

1. Elegir WABA (y token compartido o token de línea).
2. Crear el borrador o sincronizar las líneas de la WABA y asignar área canónica y categoría.
3. Registrar cada PID en Cloud API con su PIN. Este paso también valida la pertenencia a la WABA y actualiza el nombre verificado de Meta.
4. Activar. Inbound/respuesta sin reiniciar contenedores. Réplicas refrescan catálogo (~15 s).
5. Revalidar en Meta solo cuando se quiera volver a comprobar una línea ya registrada.
6. Desactivar: deja de enrutar; un PID desactivado no revive por fallback `.env`.

Cambiar nombre visible no altera la identidad de las conversaciones. Cambiar categoría solo mueve el programa. Elegir línea predeterminada del área es transaccional; los chats existentes siguen respondiendo por su propio PID.

## Envío y campañas

- Respuesta de chat: sale por la **línea de esa conversación**.
- Campaña: elige una línea de las categorías de su audiencia. Si trae categorías y no trae línea → API rechaza. Sin filtro de categoría → línea predeterminada del área.

## Credenciales

Prioridad: bóveda / Credenciales Meta (cifrada con `WHATSAPP_CREDENTIALS_MASTER_KEY`) sobre `WHATSAPP_TOKEN_*` / `PHONE_NUMBER_ID_*` del `.env`. Catálogo dinámico: `WHATSAPP_LINE_CATALOG_ENABLED`.

Detalle de Graph, webhook y `subscribed_apps`: [META-WABA.md](./META-WABA.md).
