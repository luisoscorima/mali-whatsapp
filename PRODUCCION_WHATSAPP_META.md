# Guía de producción y operación — WhatsApp API (MALI)

Documento único: requisitos, despliegue (Docker y Nginx Proxy Manager), plantillas Meta, uso del panel, errores frecuentes y checklist de salida a producción.

---

## 1. Objetivo y alcance

- Operar campañas masivas con WhatsApp Cloud API usando el MVP actual.
- Configurar Meta Developers y el webhook de forma coherente con la URL pública.
- Dejar operativos los módulos: **Enviar campaña**, **Contactos**, **Plantillas**, **Historial**, **Configuración**.
- Validar un flujo real: prueba → piloto → envío masivo controlado.

---

## 2. Arquitectura

- Aplicación: `app/server.js` (Node.js + Express + EJS).
- Base de datos: PostgreSQL (`db/init.sql`).
- Despliegue: `docker-compose.yml` + `Dockerfile`.
- Webhook de estados de mensajes:
  - Verificación: `GET /webhook`
  - Eventos: `POST /webhook`

---

## 3. Prerrequisitos en Meta (paso a paso)

1. Cuenta de Meta Business Manager (si aún no existe).
2. [Meta for Developers](https://developers.facebook.com/).
3. Crear una app de tipo **Business**.
4. Añadir el producto **WhatsApp**.
5. En **WhatsApp → API Setup** obtener:
   - Token de acceso (temporal o permanente con System User).
   - **Phone number ID**.
   - **WhatsApp Business Account ID (WABA ID)**.
6. Crear y **aprobar** una plantilla de mensaje en WhatsApp Manager.
7. Si estás en entorno de prueba (sandbox), añadir los números destino permitidos.

---

## 4. Credenciales y variables (`.env`)

Completar en la raíz del proyecto:

| Variable | Uso |
|----------|-----|
| `WHATSAPP_TOKEN` | Token de la API |
| `PHONE_NUMBER_ID` | ID del número emisor |
| `VERIFY_TOKEN` | Mismo valor que configuras en Meta para el webhook |
| `APP_SECRET` | Firma `X-Hub-Signature-256` del webhook |
| `DEFAULT_TEMPLATE_NAME` | Plantilla por defecto |
| `DEFAULT_TEMPLATE_LANGUAGE` | Código de idioma exacto en Meta (ej. `en_US`, `es`) |

### URL pública detrás de NPM (subruta `/whatsapp`)

Producción MALI: **`https://proyectosti.mali.pe/whatsapp`**

```env
BASE_PATH=/whatsapp
APP_BASE_URL=https://proyectosti.mali.pe/whatsapp
```

- `BASE_PATH`: subruta pública **sin** barra final, con `/` inicial.
- `APP_BASE_URL`: URL que ve el usuario y Meta; **sin** barra final.

En local (Docker dev o sin proxy): `BASE_PATH` vacío y `APP_BASE_URL=http://localhost:3000`.

### Seguridad recomendada en producción

- `NODE_ENV=production`
- `REQUIRE_AUTH=true` + `BASIC_AUTH_USER` + `BASIC_AUTH_PASS`
- `REQUIRE_WEBHOOK_SIGNATURE=true`
- `RATE_LIMIT_MAX=300`
- `CAMPAIGN_RATE_LIMIT_MAX=5`

### Antes de salir a producción

1. Rotar cualquier token o clave que haya estado expuesto.
2. Confirmar que `.env` no se versiona (`.gitignore` en raíz).
3. Contraseña fuerte para la autenticación básica del panel.
4. No compartir secretos por canales inseguros.
5. Mantener `APP_SECRET` y validación de firma del webhook activos.

---

## 5. Despliegue: Docker

### Producción (`docker-compose.yml`)

- **No** publica puertos en el host: la app habla con Postgres en la red interna y se expone a **Nginx Proxy Manager** por la red externa `nginx-proxy-manager_default`.
- Esa red debe existir antes (`docker network ls`); suele crearse al levantar NPM al menos una vez.
- Comando:

```bash
docker compose up -d --build
```

### Desarrollo local (hot reload)

```bash
docker compose -f docker-compose.dev.yml up --build
```

Panel en **`http://localhost:3000`** (puertos publicados; no usa la red NPM).

### Comprobar salud

- **Con puerto local** (dev): `curl -i http://localhost:3000/health` → `200` y `{"ok":true,"db":"up"}`.
- **En servidor sin puerto publicado**: usa la URL HTTPS pública (`/health`) o `docker compose exec` contra el contenedor.

---

## 6. Despliegue: Nginx Proxy Manager

URL pública del MVP: **`https://proyectosti.mali.pe/whatsapp`**.

Cuando Nginx reenvía con `proxy_pass .../`, el contenedor recibe rutas **sin** el prefijo `/whatsapp`. La app usa `BASE_PATH` y `APP_BASE_URL` para que el navegador y Meta sigan pidiendo `/whatsapp/...`.

En el proxy host de `proyectosti.mali.pe`, en **Custom Nginx Configuration** o **Custom locations**:

```nginx
location /whatsapp/ {
    proxy_pass http://mali-whatsapp-app:3000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

- Barras finales en `location` y `proxy_pass` para **quitar** el prefijo al reenviar (el contenedor ve `/`, `/webhook`, `/css/...`).
- `mali-whatsapp-app` y puerto `3000` deben coincidir con tu `docker-compose` y red Docker compartida con NPM.

### SSL

Activa HTTPS (Let’s Encrypt en NPM) **antes** de registrar el webhook en Meta.

---

## 7. Webhook en Meta

En **WhatsApp → Configuration → Webhook**:

| Campo | Valor |
|-------|--------|
| Callback URL | `https://proyectosti.mali.pe/whatsapp/webhook` (debe ser `APP_BASE_URL` + `/webhook`) |
| Verify token | Igual que `VERIFY_TOKEN` en `.env` |

Suscripciones mínimas recomendadas: `messages` y, si aplica, `message_template_status_update`.

- Meta enviará `GET /webhook` con `hub.challenge`; la app responde `200` con el challenge si el token coincide.
- Con `REQUIRE_WEBHOOK_SIGNATURE=true`, peticiones sin firma válida reciben `401`.

---

## 8. Módulo Configuración (panel)

Validar operativamente:

- Token de acceso vigente.
- Phone Number ID correcto.
- WABA ID acorde a Meta.
- Verify token y app secret alineados con el webhook.
- Versión de API coherente con el backend.

**Checklist rápido:** `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `DEFAULT_TEMPLATE_NAME` y `DEFAULT_TEMPLATE_LANGUAGE` exactos a lo aprobado en Meta.

Desde **Configuración** también puedes ajustar variables de plantilla (conteo, etiquetas, plantillas sin componentes, etc.); lo guardado en BD **tiene prioridad** sobre `TEMPLATE_BODY_*` en `.env` y no requiere rebuild.

---

## 9. Plantillas Meta: ejemplo invitación (Patronato / MALI)

WhatsApp **no** permite texto largo libre en frío: hace falta una **plantilla aprobada**. El texto fijo va en la plantilla; lo variable son `{{1}}`, `{{2}}`, … rellenados desde el panel.

### Qué crear en WhatsApp Manager

1. **Categoría**: según políticas actuales (p. ej. Marketing o Utility).
2. **Header**: tipo **Imagen** si usarás imagen por URL en el envío.
3. **Body**: texto fijo + el **número exacto** de variables y su **orden**.

### Ejemplo alineado con `.env` por defecto (4 variables)

```env
TEMPLATE_BODY_VARIABLE_COUNT=4
TEMPLATE_BODY_VARIABLE_1_FROM_CONTACT=false
TEMPLATE_BODY_VARIABLE_LABELS=Fecha y hora del evento,Dirección completa,Link RSVP,Nota o recordatorio
```

Ejemplo de cuerpo en Meta (el texto fijo es tuyo; `{{n}}` debe coincidir en número y orden):

```
Estimados miembros del Patronato de las Artes,

En nombre del Museo de Arte de Lima, nos complace invitarlos a un cóctel en casa de Alexandra Bryce, Vicepresidenta del museo, para celebrar el Patronato del MALI y compartir con ustedes nuestros proyectos para el 2026.

Será una ocasión especial para reencontrarnos y expresarles nuestro sincero agradecimiento por su constante apoyo al museo.

Los esperamos el {{1}}.

Alberto Rebaza
Presidente
Alexandra Bryce
Vicepresidenta

Dirección
{{2}}

RSVP {{3}}
{{4}}
```

| Variable | Ejemplo de contenido |
|----------|----------------------|
| `{{1}}` | `lunes 20 de abril de 2026, a las 7 p.m.` |
| `{{2}}` | `Av Pezet 561. Apt 302, San Isidro` |
| `{{3}}` | `https://www.addevent.com/event/clt2hdpl87jz` |
| `{{4}}` | `Confirmar si irá con acompañante` |

Respeta el **límite de caracteres** del body en WhatsApp Manager.

### Imagen en el envío

Ejemplo de URL pública (header imagen en Meta + campo **URL pública de imagen** en el panel):

`https://mali.pe/es/wp-content/uploads/2026/03/Coctel_Patronato.jpeg`

- Si la plantilla **no** tiene header imagen, deja el campo vacío.

### Cambios solo en fecha, hora o enlace

No hace falta cambiar código: actualizas valores en el formulario de cada campaña.

Si cambias **cuántas variables** tiene la plantilla en Meta, actualiza `TEMPLATE_BODY_VARIABLE_COUNT` y `TEMPLATE_BODY_VARIABLE_LABELS` (misma cantidad de etiquetas que variables de formulario).

Para que `{{1}}` sea el nombre del contacto: `TEMPLATE_BODY_VARIABLE_1_FROM_CONTACT=true` y en Meta el texto debe usar `{{1}}` donde iría el nombre.

---

## 10. Uso operativo por módulo

### Contactos

- `name`: obligatorio, máx. 120 caracteres.
- `phone`: E.164 **sin** `+` (solo dígitos, 8–15).
- `segment`: `suscriptor_1`, `suscriptor_2`, `suscriptor_3` o `asociado`.

Recomendación: empezar con un piloto pequeño (5–20 contactos) y tener opt-in claro.

### Plantillas (reglas)

- Solo plantillas **aprobadas** en Meta.
- `templateName` y `languageCode` **exactos** a la traducción aprobada.

### Enviar campaña

1. Elegir segmento.
2. `templateName` y `languageCode`.
3. Texto principal y, si aplica, `imageUrl` pública HTTPS.
4. Lote y pausa: `batchSize` 1–100, `batchDelayMs` 0–60000.

Buenas prácticas: empezar con `batchSize=10` y `batchDelayMs=1500`; subir volumen tras validar entrega y lectura en historial.

### Historial

- Conteos `sent`, `delivered`, `read`, `failed`.
- Errores con código de Graph API.
- Estados actualizados vía webhook.

Ante errores HTTP: `401/403` → token/permisos; `429` → bajar ritmo; `5xx` de Meta → reintentar con cuidado.

---

## 11. Errores frecuentes (API y plantillas)

| Código / síntoma | Causa probable | Qué revisar |
|------------------|----------------|-------------|
| **132000** | Número de parámetros distinto al de la plantilla | `TEMPLATE_BODY_VARIABLE_COUNT`, orden en Meta, formulario de campaña |
| **132001** | Nombre o idioma de plantilla incorrecto | Nombre exacto y `languageCode` aprobado |
| **131030** | Número no permitido en modo prueba | Lista de números permitidos en Meta (sandbox) |
| `Invalid webhook signature` | Firma no válida o secreto mal configurado | `APP_SECRET`, `REQUIRE_WEBHOOK_SIGNATURE` |
| No llegan estados | Webhook o red | Suscripción del webhook, URL HTTPS pública, firma |
| Muchos errores por límite | Ritmo alto | Reducir `batchSize`, aumentar `batchDelayMs` |

---

## 12. Procedimiento: sandbox → piloto → masivo

### Fase A — Sandbox

- [ ] Healthcheck OK.
- [ ] Webhook verificado por Meta.
- [ ] Plantilla de prueba (`hello_world`) funcionando.
- [ ] Envío a un número permitido.

### Fase B — Piloto

- [ ] 5–20 contactos reales con opt-in.
- [ ] Monitoreo de estados 30–60 min.
- [ ] Tasa de error aceptable.

### Fase C — Masivo controlado

- [ ] Ejecutar por segmentos, no todo en un solo disparo.
- [ ] Observar errores en tiempo real.
- [ ] Si sube la tasa de error, pausar y ajustar lotes.

---

## 13. Troubleshooting rápido

- **Plantilla**: nombre e idioma exactos; parámetros alineados con la plantilla en Meta.
- **Estados**: webhook suscrito, URL HTTPS correcta (incluye `/whatsapp` si aplica).
- **Rendimiento**: lotes más pequeños y más delay entre lotes.

---

## 14. Go-live: lista bloqueante

- [ ] Secretos rotados y `.env` protegido.
- [ ] Autenticación básica activa para el panel.
- [ ] Firma de webhook obligatoria en producción.
- [ ] Plantilla aprobada y validada en piloto.
- [ ] Healthcheck y base de datos estables.
- [ ] Primera campaña piloto con trazabilidad en historial.

---

## 15. Mejoras posteriores (no bloqueantes)

- Cola de envíos con reintentos y backoff.
- Alertas y métricas (entrega/error por campaña).
- Pruebas automatizadas de rutas críticas.
