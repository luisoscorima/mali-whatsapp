# MALI WhatsApp MVP

Demo funcional para campañas segmentadas por WhatsApp con:
- Backend Node.js + Express
- UI web tipo inbox (EJS) con layout unificado
- Persistencia PostgreSQL
- Despliegue con Docker Compose

## Estructura

```txt
mali-whatsapp-mvp/
  app/
    src/
      routes/          # Routers por función (auth, inbox views, campañas, conversaciones, webhook…)
      db/migrations.js # Esquema PostgreSQL idempotente (fuente de verdad al arrancar)
    public/
    views/
    server.js
  db/
    init.sql         # Nota: el esquema real lo aplica migrations.js al iniciar la app
  docker-compose.yml
  README.md
```

## Estado actual del demo

- `app/` es la aplicación principal.
- Al **arrancar** el servidor se ejecutan las migraciones PostgreSQL (`app/src/db/migrations.js`): en una BD vacía se crean tablas e índices; no hace falta importar `db/init.sql` en Docker.
- Importación masiva de contactos por **CSV** desde el panel (sección Contactos); ejemplo descargable en `/contacts/sample.csv`.
- La capa de vistas usa un único patrón basado en `conversations.ejs`: `wa-rail` + `inbox-sidebar` + `inbox-main`.
- Se eliminó el dashboard multipestaña (`hash tabs`) y ahora la navegación es por rutas reales.

## Primer arranque

1. Copia variables en el proyecto raíz:

```bash
cp .env.example .env
```

2. Completa en `.env`:
- `WHATSAPP_TOKEN_TI` / `PHONE_NUMBER_ID_TI`, `WHATSAPP_TOKEN_PAM` / `PHONE_NUMBER_ID_PAM` y `WHATSAPP_TOKEN_EDUCACION` / `PHONE_NUMBER_ID_EDUCACION` (o `WHATSAPP_TOKEN` / `PHONE_NUMBER_ID` como respaldo genérico)
- `VERIFY_TOKEN`
- `APP_SECRET` (obligatorio en produccion)
- `REQUIRE_WEBHOOK_SIGNATURE=true` en produccion
- `REQUIRE_AUTH=true` + `SESSION_SECRET` (login con correo **@mali.pe**; ver usuarios abajo)
- Opcional: `MASTER_INITIAL_PASSWORD` para crear en el **primer arranque** el usuario master `loscorima@mali.pe` (o `MASTER_USER_EMAIL` si quieres otro correo); luego quita la variable del `.env`
- `DEFAULT_TEMPLATE_NAME` y `DEFAULT_TEMPLATE_LANGUAGE` (ej. `hello_world` + `en_US` para cuentas de prueba)
- `TEMPLATES_WITHOUT_COMPONENTS` (ej. `hello_world`)
- credenciales de PostgreSQL

3. Levanta entorno local con Docker (modo deploy):

```bash
docker compose up -d --build
```

4. Usuarios del panel (correos **@mali.pe**; áreas **TI (dev)** `ti`, **PAM** `pam`, **Educación** `educacion`):

Las dependencias Node se instalan **solo al construir la imagen Docker** (`Dockerfile` + `npm install` dentro del contenedor). No hace falta ejecutar `npm` en tu sistema operativo.

- **Usuario master inicial:** si en `.env` defines `MASTER_INITIAL_PASSWORD` (y opcionalmente `MASTER_USER_EMAIL`, por defecto `loscorima@mali.pe`), al arrancar el contenedor se crea **una sola vez** ese usuario con área `ti` y rol master. Entra al panel, cambia la contraseña si quieres y **elimina `MASTER_INITIAL_PASSWORD`** del entorno.

- **Más usuarios** (desde el host, contra el contenedor `app`):

```bash
docker compose exec app sh -c 'cd /usr/src/app && node scripts/create-user.js "otro@mali.pe" "tu_clave" educacion'
docker compose exec app sh -c 'cd /usr/src/app && node scripts/create-user.js "otro@mali.pe" "tu_clave" pam master'
```

Tercer argumento: `ti`, `pam` o `educacion`. El último argumento opcional `master` marca usuario master (insignia en el panel). Cada usuario normal solo ve datos de su área; los envíos usan `WHATSAPP_TOKEN_*` / `PHONE_NUMBER_ID_*` de esa área.

5. Abre el panel:

```txt
http://localhost:3000
```

## Modo desarrollo (hot reload)

Usa el compose de desarrollo para cambios en vivo:

```bash
docker compose -f docker-compose.dev.yml up --build
```

Si aparece `Cannot find module` tras añadir dependencias en `package.json`, el volumen de `node_modules` del contenedor puede estar desactualizado: `docker compose -f docker-compose.dev.yml build --no-cache app`, luego `docker compose -f docker-compose.dev.yml run --rm app npm install`, y vuelve a levantar el compose (o revisa el comentario en `docker-compose.dev.yml`).

## Rutas principales del panel

- `GET /` redirección a `GET /campaigns`
- `GET /conversations` conversaciones (lista + hilo)
- `GET /campaigns` campañas (lista)
- `GET /campaigns/new` nueva campaña
- `GET /campaigns/:id` detalle de campaña
- `GET /contacts` contactos (lista)
- `GET /contacts/new` nuevo contacto / importación CSV
- `GET /contacts/:id` editar contacto
- `GET /segments` segmentos (lista)
- `GET /segments/new` añadir segmento
- `GET /segments/:id` editar segmento
- `GET /history` → redirección a `GET /campaigns` (compatibilidad)
- `GET /history/:id` → redirección a `GET /campaigns/:id` (compatibilidad)
- `GET /settings` ajustes

En **Campañas** (`GET /campaigns`) se muestran la lista de campañas y el **resumen global de envíos** (indicadores); el detalle de cada campaña es `GET /campaigns/:id`.

**Indicadores:** los cuatro KPI operativos en lista y detalle son **Total** (filas en `campaign_logs`), **Salida OK** (estados `sent`, `delivered` o `read`), **Error %** sobre el total y **Lectura %** (lecturas sobre Salida OK; si Salida OK es 0 se muestra —). En el detalle, **Embudo Meta (detalle)** es un desglose por estado y ratios opcionales solo para diagnóstico; no reemplaza los informes de la cuenta Meta.

## Endpoints útiles (API / sistema)

- `GET /health` salud de app + DB
- `GET /api/dashboard` datos agregados (compatibilidad para integraciones internas)
- `GET /webhook` verificación de webhook en Meta
- `POST /webhook` recepción de estados `sent/delivered/read/failed`

## Plantillas desde Meta

El panel **sincroniza** las plantillas aprobadas desde la Graph API (cuenta de WhatsApp / WABA) con el botón **Sincronizar plantillas**. No hace falta escribir nombres ni idioma a mano: al elegir una plantilla, el formulario se adapta a su estructura (cabecera imagen/video/documento, textos `{{1}}`…, botones URL dinámicos).

El token de la app debe poder leer `message_templates` (permisos de negocio / WhatsApp). Si falla la resolución automática del WABA, define en `.env` opcionalmente `WABA_ID_TI`, `WABA_ID_PAM` y/o `WABA_ID_EDUCACION`.

Si la combinación nombre/idioma no existe en Meta, verás el error `132001`. Si los parámetros no coinciden con la plantilla, verás el error `132000`.

Si estás en sandbox y sale `131030`, agrega el número destino en la lista de destinatarios permitidos de Meta Developers.

## Guía de producción y operación

Documento único (requisitos, despliegue Docker/NPM, plantillas Meta, uso del panel, errores, checklist):

- [`PRODUCCION_WHATSAPP_META.md`](PRODUCCION_WHATSAPP_META.md)

### Publicación (resumen)

El panel en producción vive en **`https://whatsapp.mali.pe`** (subdominio dedicado; sin subruta).

- **NPM:** proxy host `whatsapp.mali.pe` → contenedor `mali-whatsapp-app:3000` en la raíz (`/`), red Docker compartida con NPM.
- **`.env`:** `BASE_PATH=` (vacío), `APP_BASE_URL=https://whatsapp.mali.pe`
- **SSL:** Let’s Encrypt en el mismo proxy host.
- **Webhook Meta:** `https://whatsapp.mali.pe/webhook`

## Notas del MVP

- Usa plantillas aprobadas de WhatsApp.
- El idioma debe coincidir con una traducción existente de la plantilla en WhatsApp Manager.
- En cuentas de prueba de Meta, solo se puede enviar a números agregados en la "lista de destinatarios permitidos".
- El campo `imageUrl` asume una imagen pública.
- Los estados `sent`, `delivered`, `read`, `failed` se actualizan desde `/webhook`.
- Para una siguiente fase conviene agregar cola con Redis.
