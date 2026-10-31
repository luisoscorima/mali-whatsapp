# Campañas

Envíos masivos de plantillas aprobadas con cola Redis/BullMQ.

Histórico: [CAMPANAS-CHANGELOG.md](./CAMPANAS-CHANGELOG.md). Relacionado: [PLANTILLAS.md](./PLANTILLAS.md), [SEGMENTOS.md](./SEGMENTOS.md), [LINEAS.md](./LINEAS.md), [META-WABA.md](./META-WABA.md).

## Flujo

1. Elegir plantilla **APPROVED** (+ idioma).
2. Audiencia: segmentos / contactos + exclusiones; filtro `category=` en Educación ([SEGMENTOS.md](./SEGMENTOS.md)).
3. Parámetros `{{n}}`: fijos o por atributo de contacto; preview.
4. Línea de envío alineada a las categorías (obligatoria si hay filtro de categoría).
5. Envío inmediato o programado → worker BullMQ.
6. KPIs: salida OK, error %, lectura %; detalle: respondieron (ventana configurable), fallidos + CSV, costo WABA, reintento auto/manual.

Pantallas: `/campaigns`, `/campaigns/new`, `/campaigns/:id`.

## APIs útiles

- `POST /api/campaigns/recipients-preview`
- `GET /api/campaigns/:id/failed-export`
- `POST /api/campaigns/:id/retry-failed`
- `POST /api/campaigns/:id/sync-cost`

Env: `CAMPAIGN_AUTO_RETRY_DELAY_MINUTES`, `CAMPAIGN_MAX_RETRY_ATTEMPTS`, `CAMPAIGN_RESPONSE_WINDOW_DAYS`, `CAMPAIGN_COST_PER_MESSAGE_USD`.

## Costos

El costo en detalle de campaña es el del **envío WABA** (plantillas), no el spend de pauta Ads. Tarifas: [META-WABA.md](./META-WABA.md).

## Respuestas a campaña

Un inbound que responde a un envío outbound **no** marca el origen de captación como “con chat” en Leads; ver regla en [LEADS.md](./LEADS.md).
