# Runbook de Produccion - WhatsApp API (MALI)

Este documento te lleva de cero a envio real en produccion con el MVP actual.
Esta pensado para ejecutar hoy mismo con control de riesgo.

## 1) Objetivo y alcance

- Levantar el sistema de campanas masivas con WhatsApp Cloud API.
- Configurar Meta Developers correctamente.
- Dejar operativos estos modulos: `Enviar Campana`, `Contactos`, `Plantillas`, `Historial`, `Configuracion`.
- Validar un flujo real: prueba -> piloto -> envio masivo.

## 2) Arquitectura actual (la que se usara hoy)

- App principal: `app/server.js` (Node.js + Express + EJS).
- Base de datos: PostgreSQL (`db/init.sql`).
- Despliegue: `docker-compose.yml` + `Dockerfile`.
- Webhook de estados:
  - Verificacion: `GET /webhook`
  - Eventos: `POST /webhook`

## 3) Prerrequisitos en Meta (paso a paso)

1. Crear cuenta de Meta Business Manager (si aun no existe).
2. Entrar a [Meta for Developers](https://developers.facebook.com/).
3. Crear App de tipo `Business`.
4. Agregar producto `WhatsApp`.
5. En `WhatsApp > API Setup` obtener:
   - `Temporary access token` (o token permanente si ya tienes System User).
   - `Phone number ID`.
   - `WhatsApp Business Account ID (WABA ID)`.
6. Crear y aprobar una plantilla de mensaje en WhatsApp Manager.
7. Si estas en entorno de prueba (sandbox), agregar los numeros destino permitidos.

## 4) Credenciales que necesitas para este sistema

Completar en `.env` del proyecto:

- `WHATSAPP_TOKEN`
- `PHONE_NUMBER_ID`
- `VERIFY_TOKEN`
- `APP_SECRET`
- `DEFAULT_TEMPLATE_NAME`
- `DEFAULT_TEMPLATE_LANGUAGE`

Variables de seguridad recomendadas para produccion:

- `NODE_ENV=production`
- `REQUIRE_AUTH=true`
- `BASIC_AUTH_USER=<usuario_admin>`
- `BASIC_AUTH_PASS=<password_fuerte>`
- `REQUIRE_WEBHOOK_SIGNATURE=true`
- `RATE_LIMIT_MAX=300`
- `CAMPAIGN_RATE_LIMIT_MAX=5`

## 5) Seguridad obligatoria antes de salir

1. Rotar inmediatamente cualquier token/clave expuesto previamente.
2. Verificar que `.env` no se suba al repositorio (hay `.gitignore` en raiz).
3. Usar password fuerte para auth basica del panel.
4. No compartir tokens por chat/correo sin cifrado.
5. Mantener `APP_SECRET` y validacion de firma habilitados en produccion.

## 6) Configuracion del sistema (modulo: Configuracion)

Aunque la app principal usa variables de entorno, operativamente la seccion `Configuracion` corresponde a validar:

- Token de acceso valido.
- Phone Number ID correcto.
- WABA ID identificado en Meta.
- Verify token y app secret listos para webhook.
- Version de API coherente (la app usa endpoint Graph actual configurado en backend).

Checklist rapido:

- `WHATSAPP_TOKEN` con permisos vigentes.
- `PHONE_NUMBER_ID` del numero emisor correcto.
- `DEFAULT_TEMPLATE_NAME` existente y aprobada.
- `DEFAULT_TEMPLATE_LANGUAGE` igual al idioma aprobado (ej. `en_US` o `es`).

## 7) Levantar entorno

1. Copiar variables:

```bash
cp .env.example .env
```

2. Editar `.env` con valores reales.
3. Levantar servicios:

```bash
docker compose up -d --build
```

4. Validar salud:

```bash
curl -i http://localhost:3000/health
```

Debe responder `200` y `{"ok":true,"db":"up"}`.

## 8) Configurar webhook en Meta

En WhatsApp > Configuration > Webhook:

- Callback URL: `https://TU_DOMINIO/webhook`
- Verify token: el valor de `VERIFY_TOKEN`
- Suscribirte al menos a `messages` y `message_template_status_update` (si aplica en tu flujo).

Prueba de verificacion:

- Meta hara `GET /webhook` con `hub.challenge`.
- El backend responde `200` con el challenge si el verify token coincide.

Seguridad de firma:

- Con `REQUIRE_WEBHOOK_SIGNATURE=true`, si falta firma valida, el backend rechaza con `401`.

## 9) Modulo Contactos (operacion)

Formato esperado:

- `name`: obligatorio, max 120 chars.
- `phone`: obligatorio, formato E.164 sin `+` (solo digitos, 8-15).
- `segment`: uno de:
  - `suscriptor_1`
  - `suscriptor_2`
  - `suscriptor_3`
  - `asociado`

Recomendaciones:

- Cargar primero un grupo piloto pequeno (5-20 contactos).
- Confirmar opt-in legal antes de cualquier envio.

## 10) Modulo Plantillas (operacion)

Reglas de produccion:

- Solo usar plantillas aprobadas en Meta.
- `templateName` debe coincidir exacto.
- `languageCode` debe coincidir exacto con traduccion aprobada.

Errores comunes:

- `132001`: plantilla/idioma no coincide.
- `132000`: parametros enviados no coinciden con plantilla.

## 11) Modulo Enviar Campana (operacion)

Flujo recomendado:

1. Elegir segmento.
2. Ingresar `templateName` y `languageCode`.
3. Definir texto principal y opcionalmente `imageUrl` publica.
4. Configurar lote y pausa:
   - `batchSize`: 1 a 100
   - `batchDelayMs`: 0 a 60000
5. Ejecutar envio.

Buenas practicas hoy:

- Empezar con `batchSize=10` y `batchDelayMs=1500`.
- Subir volumen solo tras validar entrega y lectura en historial.

## 12) Modulo Historial (monitoreo)

Revisar por cada campana:

- Conteo `sent`, `delivered`, `read`, `failed`.
- Mensajes con `error` y su codigo de Graph API.
- Evolucion del estado via webhook.

Acciones ante errores:

- `401/403`: revisar token/permisos.
- `429`: bajar ritmo y revisar limites.
- `5xx` de Meta: reintentar en ventana controlada.

## 13) Procedimiento de primer envio real (checklist operativo)

### Fase A - Sandbox

- [ ] Healthcheck OK.
- [ ] Webhook validado por Meta.
- [ ] Plantilla de prueba (`hello_world`) funcionando.
- [ ] Envio a 1 numero permitido.

### Fase B - Piloto

- [ ] 5-20 contactos reales con opt-in.
- [ ] Monitoreo de estados por 30-60 min.
- [ ] Verificacion de tasa de error aceptable.

### Fase C - Masivo controlado

- [ ] Ejecutar por segmentos, no todo en un solo disparo.
- [ ] Observar errores en tiempo real.
- [ ] Si sube error rate, pausar y ajustar lotes.

## 14) Troubleshooting rapido

- Error `Invalid webhook signature`:
  - Verificar `APP_SECRET` y firma enviada por Meta.
  - Confirmar `REQUIRE_WEBHOOK_SIGNATURE`.
- Error de plantilla:
  - Verificar nombre exacto y codigo de idioma.
- No llegan estados:
  - Revisar suscripcion del webhook y URL publica HTTPS.
- Muchos errores por limite:
  - Reducir `batchSize` y aumentar `batchDelayMs`.

## 15) Go-Live hoy: lista bloqueante final

- [ ] Secretos rotados y `.env` protegido.
- [ ] Auth basica activa para panel y endpoints internos.
- [ ] Firma de webhook requerida en produccion.
- [ ] Plantilla aprobada y validada en piloto.
- [ ] Healthcheck y DB estables.
- [ ] Primera campana piloto completada con trazabilidad en historial.

## 16) Recomendaciones post-hoy (no bloqueante)

- Implementar cola de envios + reintentos con backoff.
- Agregar alertas y metricas (tasa de entrega/error por campana).
- Incorporar pruebas automatizadas de rutas criticas.
