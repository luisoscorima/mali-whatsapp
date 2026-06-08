# Configuración Meta (Developers + Business Manager) — WhatsApp Cloud API

Guía centrada en **integración con Meta**: [developers.facebook.com](https://developers.facebook.com), [business.facebook.com](https://business.facebook.com), tokens, webhooks, estados de solicitudes, y comandos **`curl`** imprescindibles cuando la interfaz de Meta falla o no muestra la opción.

La **arquitectura de la app, Docker, Nginx, variables generales y uso del panel** están en **[DESPLIEGUE_PRODUCCION_APP.md](./DESPLIEGUE_PRODUCCION_APP.md)**.

---

## Índice

1. [Principios: outbound vs inbound](#1-principios-outbound-vs-inbound)
2. [Meta Developers — flujo inicial](#2-meta-developers--flujo-inicial)
3. [Agregar un número nuevo (desde la app)](#3-agregar-un-número-nuevo-desde-la-app)
4. [Verificar número por SMS (`request_code`)](#4-verificar-número-por-sms-request_code)
5. [Business Manager: activos del usuario de sistema](#5-business-manager-activos-del-usuario-de-sistema)
6. [Registrar el número en Cloud API (`register`)](#6-registrar-el-número-en-cloud-api-register)
7. [Suscribir la app al WABA (`subscribed_apps`) — crítico para webhooks](#7-suscribir-la-app-al-waba-subscribed_apps--crítico-para-webhooks)
8. [Varias WABA: por qué solo una línea recibe webhooks](#8-varias-waba-por-qué-solo-una-línea-recibe-webhooks)
9. [Credenciales y mapa Meta → entorno](#9-credenciales-y-mapa-meta--entorno)
10. [App Secret (firma del webhook)](#10-app-secret-firma-del-webhook)
11. [Webhook en Meta (callback URL, verify token, campos)](#11-webhook-en-meta-callback-url-verify-token-campos)
12. [Prueba manual del GET de verificación (`curl`)](#12-prueba-manual-del-get-de-verificación-curl)
13. [WhatsApp Manager: plantillas y estados](#13-whatsapp-manager-plantillas-y-estados)
14. [Errores frecuentes (Meta y webhook)](#14-errores-frecuentes-meta-y-webhook)
15. [Troubleshooting webhook (mensajes entrantes)](#15-troubleshooting-webhook-mensajes-entrantes)

---

## 1. Principios: outbound vs inbound

| Dirección | Qué necesitas | Por qué |
|-----------|----------------|---------|
| **API outbound (envíos)** | **Token** con permisos + **Phone number ID** correcto | Graph acepta `POST /{phone-number-id}/messages` si el token puede actuar sobre ese número. |
| **Webhook inbound (respuestas del cliente)** | La **WABA** debe tener a tu **app** en `GET /{waba-id}/subscribed_apps` | Meta solo envía `POST` a tu callback URL para eventos de cuentas donde la app está **suscrita** a esa WABA. Activar “messages” en la pantalla de webhook **no** sustituye siempre ese vínculo por WABA. |

**Experiencia real (MALI):** al configurar la primera línea (p. ej. TI), Meta a veces registra la suscripción app↔WABA **automáticamente**. Al añadir una **segunda WABA** (p. ej. Educación) manualmente o después, ese “vínculo de escucha” **a veces no se crea solo**: los envíos masivos funcionan (outbound), pero **no llega nada al webhook** hasta ejecutar `POST /{waba-id}/subscribed_apps`.

La UI de Meta cambia con frecuencia y a veces **no expone** claramente `subscribed_apps` o falla el registro del número; por eso los comandos de las secciones siguientes son el respaldo fiable.

**Versión de API en ejemplos:** `v20.0` (ajusta si tu proyecto usa otra, p. ej. `v25.0`).

---

## 2. Meta Developers — flujo inicial

Entorno: [Meta for Developers](https://developers.facebook.com/). Conviene tener acceso al **Meta Business** asociado al WhatsApp Business.

### 2.1 Crear la app

1. **Mis apps** → **Crear app**.
2. Tipo de caso de uso: **Negocio / Business** (según el asistente actual de Meta).
3. Completa nombre, email de contacto y vinculación a cuenta de negocio si lo solicita → **Crear app**.

### 2.2 Añadir el producto WhatsApp

1. En el panel de la app: **Añadir producto** (Add products).
2. Localiza **WhatsApp** → **Configurar** / **Set up**.

### 2.3 API Setup (credenciales de envío y plantillas)

En el menú lateral: **WhatsApp** → **Introducción** / **API Setup** / **Configuración de la API**.

| En la pantalla de Meta | Uso en el MVP |
|------------------------|----------------|
| **Token de acceso** (temporal ~24 h o de larga duración) | `WHATSAPP_TOKEN` o `WHATSAPP_TOKEN_PAM` / `WHATSAPP_TOKEN_PATRONATO` / `WHATSAPP_TOKEN_EDUCACION` |
| **Phone number ID** (ID numérico largo; **no** es el +51…) | `PHONE_NUMBER_ID` o `PHONE_NUMBER_ID_PAM` / `PHONE_NUMBER_ID_PATRONATO` / `PHONE_NUMBER_ID_EDUCACION` |
| **WhatsApp Business Account ID (WABA)** | Opcional: `WABA_ID_PAM` / `WABA_ID_PATRONATO` / `WABA_ID_EDUCACION` si falla la detección al sincronizar plantillas |
| Números de **prueba** / lista de destinatarios permitidos | En modo desarrollo, solo esos números reciben mensajes |

**Token de larga duración (recomendado en producción):** suele obtenerse desde **Administrador comercial** (usuarios del sistema y permisos sobre el activo de WhatsApp) o desde el flujo de generación de token en la sección WhatsApp de la app.

---

## 3. Agregar un número nuevo (desde la app)

1. En [developers.facebook.com](https://developers.facebook.com) → **tu app** → **WhatsApp** → flujo de **añadir número** / **Administrar números de teléfono** (el nombre exacto varía).
2. Sigue el asistente; Meta suele pedir **confirmación por SMS** al número.
3. Si el SMS no llega o la UI se queda colgada, usa los pasos manuales de las secciones [4](#4-verificar-número-por-sms-request_code) y [6](#6-registrar-el-número-en-cloud-api-register).

---

## 4. Verificar número por SMS (`request_code`)

Solo si Meta **aún no** ha verificado la propiedad del número (o la UI no te deja completar el paso).

Sustituye `{PHONE_NUMBER_ID}` por el ID numérico de **API Setup** del número (no el +51 ni el WABA).

```bash
curl -X POST \
  "https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}/request_code" \
  -H "Authorization: Bearer TU_TOKEN_AQUÍ" \
  -F "code_method=SMS" \
  -F "language=es"
```

**Ejemplo** (número TI ilustrativo; usa el ID real de tu línea):

```bash
curl -X POST \
  "https://graph.facebook.com/v20.0/1137444669442694/request_code" \
  -H "Authorization: Bearer TU_TOKEN_AQUÍ" \
  -F "code_method=SMS" \
  -F "language=es"
```

Si la respuesta indica que el número **ya está verificado** (p. ej. error OAuth **136024**, subcódigo **2388366**), **no** hace falta repetir este paso: pasa directamente a [`register`](#6-registrar-el-número-en-cloud-api-register).

---

## 5. Business Manager: activos del usuario de sistema

Para que los tokens de sistema puedan operar **todas** las líneas que usará el CRM:

1. [business.facebook.com](https://business.facebook.com) → **Configuración** → **Usuarios** → **Usuarios del sistema**.
2. Abre el usuario que uses para tokens (p. ej. **sistemas API**).
3. **Asignar activos** (o equivalente): deben figurar **todas** las **cuentas de WhatsApp** / números que quieras usar con el sistema, con permisos adecuados (p. ej. acceso total a la cuenta de WhatsApp y a la app).

Si falta un activo aquí, el token puede fallar para esa WABA aunque el número aparezca en Developers.

---

## 6. Registrar el número en Cloud API (`register`)

Si el número queda **Pendiente** en WhatsApp Manager o los envíos fallan con **`(#133010) Account not registered`**, hay que **registrar** el número contra la Cloud API con el **PIN de verificación en dos pasos** (6 dígitos) que configuraste para ese número en Meta — **no** es el token de la app.

Cuando la interfaz de Meta **falla**, usa `curl` con **form-data** (`-F`), que en la práctica suele comportarse mejor que JSON según entorno:

```bash
curl -X POST \
  "https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}/register" \
  -H "Authorization: Bearer TU_TOKEN_AQUÍ" \
  -F "messaging_product=whatsapp" \
  -F "pin=UN_PIN_QUE_TU_ELIJAS"
```

**Ejemplo** (mismo ID de ejemplo que arriba):

```bash
curl -X POST \
  "https://graph.facebook.com/v20.0/1137444669442694/register" \
  -H "Authorization: Bearer TU_TOKEN_AQUÍ" \
  -F "messaging_product=whatsapp" \
  -F "pin=UN_PIN_QUE_TU_ELIJAS"
```

Respuesta esperada: `{"success":true}`. Tras esto el estado en el panel suele pasar a **Conectado** y los envíos dejan de responder **133010** (si `PHONE_NUMBER_ID_*` y token coinciden con ese número).

**Alternativa JSON** (si tu entorno la prefiere):

```bash
curl -X POST "https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}/register" \
  -H "Authorization: Bearer TU_TOKEN_AQUÍ" \
  -H "Content-Type: application/json" \
  -d '{"messaging_product":"whatsapp","pin":"123456"}'
```

**Seguridad:** no compartas tokens en chats, issues ni capturas; rota el token si se expuso.

---

## 7. Suscribir la app al WABA (`subscribed_apps`) — crítico para webhooks

Tras registrar el número en la nube, **aún puede faltar** que la **app** esté suscrita a la **WABA** del número. En Developers puede parecer que el webhook está bien; sin embargo, **sin** esta suscripción **no llegan** (o no llegan de forma fiable) los eventos entrantes para esa cuenta.

### 7.1 Ver en qué apps está suscrita la WABA

Sustituye `{WABA_ID}` por el **ID de la cuenta de WhatsApp Business** (WhatsApp Manager → cuenta → identificador), **no** el Phone number ID.

```bash
curl -G "https://graph.facebook.com/v20.0/{WABA_ID}/subscribed_apps" \
  -d "access_token=TU_TOKEN_DE_SISTEMA"
```

**Ejemplo** (WABA Educación MALI):

```bash
curl -G "https://graph.facebook.com/v20.0/983584127989245/subscribed_apps" \
  -d "access_token=EAAM4bQO7kUkBRNSaT4iV5SZAb73safm9UPdhyyhOzz4z4XrQVsrqB4j333cW1tCt08vwBN9lU8coHALg89TjbxBSXtCpqi8ay93MQLnGIJDoGzdGHZAGgtScZBtoPdG3lNQYtXUFpykHMU4CLaSVuJ27YZBseWamafW2AzZACrXpFjA8636u5upn5YK6kocqu6QZDZD"
```

Respuesta **válida** (tu app aparece en `data`), ejemplo:

```json
{"data":[{"whatsapp_business_api_data":{"name":"MALI - NOTICIAS","id":"906465795346761"}}]}
```

### 7.2 Si `{"data": []}` — aquí está el problema frecuente

La app **no** está suscrita a esa WABA: **no recibirás** webhooks de mensajes entrantes para esa línea (aunque el envío masivo funcione).

### 7.3 Solución: suscribir la app

```bash
curl -X POST "https://graph.facebook.com/v20.0/{WABA_ID}/subscribed_apps" \
  -d "access_token=TU_TOKEN_DE_SISTEMA"
```

**Ejemplo:**

```bash
curl -X POST "https://graph.facebook.com/v20.0/983584127989245/subscribed_apps" \
  -d "access_token=EAAM4bQO7kUkBRNSaT4iV5SZAb73safm9UPdhyyhOzz4z4XrQVsrqB4j333cW1tCt08vwBN9lU8coHALg89TjbxBSXtCpqi8ay93MQLnGIJDoGzdGHZAGgtScZBtoPdG3lNQYtXUFpykHMU4CLaSVuJ27YZBseWamafW2AzZACrXpFjA8636u5upn5YK6kocqu6QZDZD"
```

Vuelve a ejecutar el **GET** de [7.1](#71-ver-en-qué-apps-está-suscrita-la-waba): debe aparecer tu **App ID** (p. ej. `906465795346761`).

Si ya aparecía tu App ID y **aun así** no hay POST al servidor, entonces el siguiente sospechoso es permisos del token o URL/firewall; pero si **ya envías campañas** con ese número, lo habitual es que faltara justamente `subscribed_apps`.

---

## 8. Varias WABA: por qué solo una línea recibe webhooks

- **Outbound:** basta token + Phone number ID → por eso una línea nueva puede **enviar** campañas sin problema.
- **Inbound:** Meta entrega webhooks por **WABA** suscrita a tu app → si la segunda WABA nunca recibió `POST .../subscribed_apps`, los **POST** a tu URL solo reflejan la primera cuenta (p. ej. TI).

En logs del servidor deberías ver, al contestar en la línea correcta, `entryId` igual al **WABA** de esa línea y `metadata.phone_number_id` del número correspondiente.

---

## 9. Credenciales y mapa Meta → entorno

Resumen alineado con `.env` y panel **`/admin/meta`** (prioridad BD sobre env; ver [DESPLIEGUE_PRODUCCION_APP.md](./DESPLIEGUE_PRODUCCION_APP.md)).

| Variable `.env` | Origen en Meta |
|-----------------|----------------|
| `VERIFY_TOKEN` | Lo **defines tú** en Webhook → Verify token (mismo valor en la app) |
| `APP_SECRET` | App → **Configuración** → **Básica** → App Secret |
| `WHATSAPP_TOKEN_*` | Token de sistema o de acceso con permisos WhatsApp sobre el activo |
| `PHONE_NUMBER_ID_*` | WhatsApp → **API Setup** → Phone number ID |
| `WABA_ID_*` | WhatsApp Manager / cuenta → **ID de la cuenta de WhatsApp Business** |

---

## 10. App Secret (firma del webhook)

1. **Configuración de la app** → **Básica** (App settings → Basic).
2. **Clave secreta de la aplicación (App Secret)** → mostrar y copiar.
3. En tu `.env`: **`APP_SECRET`** — valida el header `X-Hub-Signature-256` en `POST /webhook` cuando `REQUIRE_WEBHOOK_SIGNATURE=true`.

---

## 11. Webhook en Meta (callback URL, verify token, campos)

**Requisito:** HTTPS público ya funcionando (mismo dominio que `APP_BASE_URL`).

1. **WhatsApp** → **Configuración** (Configuration).
2. **Webhook** → **Editar**.
3. **Callback URL:** `https://whatsapp.mali.pe/webhook` (ejemplo: debe ser **`APP_BASE_URL` + `/webhook`**, ruta **singular** `/webhook`).
4. **Verify token:** la misma cadena que **`VERIFY_TOKEN`** en `.env` / panel.
5. Tras guardar, Meta envía un **GET** de verificación; la app debe responder **200** con el `hub.challenge` si el token coincide.
6. **Campos suscritos:** como mínimo **`messages`**; opcional **`message_template_status_update`**.

**Nota sobre la lista larga de campos:** en una misma pantalla pueden aparecer muchos campos en **No suscritos**. Lo importante es la sección donde conste **`messages`** como **Suscritos** (puede haber que hacer scroll).

Con `REQUIRE_WEBHOOK_SIGNATURE=true`, los **`POST`** sin firma válida reciben **401**. La firma `X-Hub-Signature-256` se calcula sobre el **cuerpo JSON en bruto**; la app debe usar ese mismo buffer.

**`VERIFY_TOKEN` con caracteres especiales (`+`, `=`, `#`, espacios):** en `.env` usa comillas dobles, p. ej. `VERIFY_TOKEN="abc+def="`.

---

## 12. Prueba manual del GET de verificación (`curl`)

### Por qué `curl -I` puede confundir

- **`curl -I https://…/webhook`** (solo cabeceras, método **HEAD**) **sin** query string **no** reproduce la verificación de Meta. La app puede responder **403** si faltan `hub.mode` / `hub.verify_token` correctos.
- Rutas **`/webhooks`** (plural) o **`/`** con auth pueden dar **302** al login si `REQUIRE_AUTH=true` — la ruta del proyecto es **`/webhook`** (singular).

### Prueba recomendada (sustituye `TU_VERIFY_TOKEN`)

```bash
curl -sS -G "https://whatsapp.mali.pe/webhook" \
  --data-urlencode "hub.mode=subscribe" \
  --data-urlencode "hub.verify_token=TU_VERIFY_TOKEN" \
  --data-urlencode "hub.challenge=prueba_ok_123"
```

Respuesta esperada: cuerpo **`prueba_ok_123`** y HTTP **200**.

---

## 13. WhatsApp Manager: plantillas y estados

Desde el ecosistema Meta / Business: **WhatsApp Manager** — crear plantillas, enviar a revisión y esperar estado **Aprobada**. Sin plantilla aprobada no hay envíos masivos “en frío” con texto libre.

---

## 14. Errores frecuentes (Meta y webhook)

| Código / síntoma | Causa probable | Qué revisar |
|------------------|----------------|-------------|
| **131030** | Número no permitido en modo prueba | Lista de números permitidos en Meta (sandbox) |
| **133010** `Account not registered` | Número no registrado en Cloud API | [Sección 6 — `register`](#6-registrar-el-número-en-cloud-api-register) |
| **136024** (subcódigo 2388366) | «Número ya verificado» al pedir SMS | Normal: seguir con **`register`** |
| `Invalid webhook signature` | Secreto o cuerpo incorrecto | `APP_SECRET`, `REQUIRE_WEBHOOK_SIGNATURE` |
| No llegan **mensajes entrantes** pero sí envíos | `subscribed_apps` vacío para esa WABA | [Sección 7](#7-suscribir-la-app-al-waba-subscribed_apps--crítico-para-webhooks) |
| No llegan estados | Webhook, red o suscripción | URL HTTPS, campos `messages`, firma |
| **132000** / **132001** | Plantilla | [DESPLIEGUE_PRODUCCION_APP.md](./DESPLIEGUE_PRODUCCION_APP.md) |

---

## 15. Troubleshooting webhook (mensajes entrantes)

1. **Dos pantallas distintas en Developers**  
   Muchos campos pueden estar en **No suscritos** y ser normales. Para conversación, debe estar **`messages`** en **Suscritos**.

2. **¿Llega el POST al servidor?**  
   En logs: `Webhook POST procesado`. Si solo ves **401**, revisa `APP_SECRET` y firma.

3. **¿Meta envía `messages` en el JSON?**  
   Pon temporalmente **`WEBHOOK_DEBUG=true`** en `.env`, reinicia la app y revisa `Webhook DEBUG estructura`: `messagesCount` > 0 al escribir desde el móvil. Quita `WEBHOOK_DEBUG` tras diagnosticar.

4. **Área (`pam` / `patronato` / `educacion`)**  
   Si `metadata.phone_number_id` viene vacío, ayuda **`WABA_ID_*`** coincidente con `entry.id`, o una sola línea `PHONE_NUMBER_ID_*` configurada. Si el POST ni siquiera llega con el WABA correcto, prioriza **`subscribed_apps`** ([sección 7](#7-suscribir-la-app-al-waba-subscribed_apps--crítico-para-webhooks)).

5. **Teléfono del remitente**  
   Si ves `Webhook inbound: ningun mensaje insertado` con `skippedInvalidPhone` > 0, el `from` de Meta no pasó validación E.164 sin `+`.

### Orden mínimo resumido (Meta)

1. Business / acceso al portafolio correcto.  
2. App en Developers + producto WhatsApp.  
3. Phone number ID + token + (opcional) WABA.  
4. Verificar SMS si aplica → **`register`** con PIN si hace falta.  
5. **Usuario de sistema** con todos los activos WhatsApp necesarios.  
6. **`GET /{waba-id}/subscribed_apps`** → si `data` vacío, **`POST /{waba-id}/subscribed_apps`**.  
7. App Secret.  
8. HTTPS público → Webhook + Verify token.  
9. Plantillas aprobadas → panel **Sincronizar plantillas**.
