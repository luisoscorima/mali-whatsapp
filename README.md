# MALI WhatsApp MVP

Demo funcional para campañas segmentadas por WhatsApp con:
- Backend Node.js + Express
- UI web tipo dashboard (inspirada en `mali-whatsapp-mvp-firebase`)
- Persistencia PostgreSQL
- Despliegue con Docker Compose

## Estructura

```txt
mali-whatsapp-mvp/
  app/
    public/
      css/
        styles.css
    views/
      campaign-detail.ejs
      dashboard.ejs
    package.json
    server.js
  db/
    init.sql
  .env.example
  docker-compose.yml
  Dockerfile
  README.md
```

## Estado actual del demo

- `app/` es la aplicación principal productiva del demo.
- Importación masiva de contactos por **CSV** desde el panel (sección Contactos); ejemplo descargable en `/contacts/sample.csv`.
- `mali-whatsapp-mvp-firebase/` queda como referencia visual y prototipo (no es requisito para ejecutar el MVP).
- `whatsapp-business-jaspers-market/` queda como referencia oficial de Meta para flujos avanzados.

## Primer arranque

1. Copia variables en el proyecto raíz:

```bash
cp .env.example .env
```

2. Completa en `.env`:
- `WHATSAPP_TOKEN`
- `PHONE_NUMBER_ID`
- `VERIFY_TOKEN`
- `APP_SECRET` (obligatorio en produccion)
- `REQUIRE_WEBHOOK_SIGNATURE=true` en produccion
- `REQUIRE_AUTH=true` + `BASIC_AUTH_USER` + `BASIC_AUTH_PASS`
- `DEFAULT_TEMPLATE_NAME` y `DEFAULT_TEMPLATE_LANGUAGE` (ej. `hello_world` + `en_US` para cuentas de prueba)
- `TEMPLATES_WITHOUT_COMPONENTS` (ej. `hello_world`)
- credenciales de PostgreSQL

3. Levanta entorno local con Docker (modo deploy):

```bash
docker compose up -d --build
```

4. Abre el panel:

```txt
http://localhost:3000
```

## Modo desarrollo (hot reload)

Usa el compose de desarrollo para cambios en vivo:

```bash
docker compose -f docker-compose.dev.yml up --build
```

## Endpoints útiles

- `GET /` dashboard principal
- `GET /health` salud de app + DB
- `GET /api/dashboard` datos JSON del dashboard
- `GET /webhook` verificación de webhook en Meta
- `POST /webhook` recepción de estados `sent/delivered/read/failed`

## Plantillas e idioma (rápido)

Usa siempre el código exacto del idioma configurado para cada plantilla en WhatsApp Manager.

| Caso | Template | Language code |
|---|---|---|
| Sandbox Meta (recomendado para pruebas) | `hello_world` | `en_US` |
| Producción MALI (ejemplo) | `mali_novedades_generales` | `es` |

Si la combinación no existe en Meta, verás el error `132001`.
Si envías parámetros a una plantilla que no los espera, verás el error `132000`.

## Presets para `.env`

Para que no tengas que adivinar valores, copia uno de estos bloques:

Sandbox / Test App:

```env
DEFAULT_TEMPLATE_NAME=hello_world
DEFAULT_TEMPLATE_LANGUAGE=en_US
```

Producción (cuando la plantilla MALI esté aprobada y activa):

```env
DEFAULT_TEMPLATE_NAME=mali_novedades_generales
DEFAULT_TEMPLATE_LANGUAGE=es
```

Si estás en sandbox y sale `131030`, agrega el número destino en la lista de destinatarios permitidos de Meta Developers.

## Runbook de produccion

Guia operativa completa paso a paso:

- `PRODUCCION_WHATSAPP_META.md`

Ejemplo de plantilla de invitación (variables + imagen) y alineación con `.env`:

- `META_PLANTILLA_INVITACION_MALI.md`

## Publicación detrás de Nginx Proxy Manager

Cuando ya tengas el subdominio:
- dominio: `whatsapp.mali.pe`
- forward host: IP o hostname del host Docker
- port: `3000`
- SSL: Let's Encrypt
- webhook en Meta: `https://whatsapp.mali.pe/webhook`

## Notas del MVP

- Usa plantillas aprobadas de WhatsApp.
- El idioma debe coincidir con una traducción existente de la plantilla en WhatsApp Manager.
- En cuentas de prueba de Meta, solo se puede enviar a números agregados en la "lista de destinatarios permitidos".
- El campo `imageUrl` asume una imagen pública.
- Los estados `sent`, `delivered`, `read`, `failed` se actualizan desde `/webhook`.
- Para una siguiente fase conviene agregar importación CSV, autenticación y cola con Redis.
