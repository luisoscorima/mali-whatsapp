# Migración segura a Área + WABA + Línea

Runbook de la migración desde el modelo MVP (una línea por `area`) al catálogo dinámico. Este procedimiento aplica por igual a Educación, PAM, Patronato, TI y áreas futuras.

## Alcance de esta primera entrega

- Crea catálogos de áreas canónicas, alias heredados, credenciales, WABA y líneas.
- Relaciona opcionalmente conversaciones y campañas con una línea, y plantillas con una WABA.
- Conserva intactos los campos `area`, `whatsapp_phone_number_id`, `app_settings` y todas las variables actuales.
- No fusiona aún contactos ni cambia el enrutamiento en ejecución.
- No copia tokens: registra solo dónde se obtiene cada token y una huella SHA-256.

Por tanto, aplicar únicamente la migración SQL no cambia qué línea recibe o envía mensajes.

## Modelo inicial esperado

| Alias actual | Área canónica | Programa | Línea predeterminada |
|---|---|---|---|
| `ti` | `ti` | — | Sí |
| `pam` | `pam` | — | Sí |
| `patronato` | `patronato` | — | Sí |
| `educacion` | `educacion` | — | Sí |
| `educacion_ca` | `educacion` | `ca` | No |
| `educacion_ep` | `educacion` | `ep` | No |

Las tres líneas de Educación pueden compartir una WABA y conservar credenciales distintas por línea durante la transición.

## Secuencia de producción

### 1. Precondiciones

- Respaldo reciente y verificado.
- Las tres líneas actuales de Educación operativas.
- `WABA_ID_*`, `PHONE_NUMBER_ID_*` y `WHATSAPP_TOKEN_*` disponibles en el contenedor API, o sus equivalentes en `app_settings`.
- Código revisado; no agregar todavía las seis líneas nuevas.

### 2. Aplicar únicamente la migración aditiva

El entrypoint de la API ejecuta `prisma migrate deploy` antes de iniciar NestJS. Tras desplegar la imagen que contiene esta migración, comprobar:

```bash
docker compose ps
docker compose logs --tail=120 api
curl -fsS https://whatsapp.mali.pe/health
```

La API todavía usa las credenciales heredadas, así que este despliegue no hace cutover.

### 3. Inspeccionar el plan de importación (solo lectura)

```bash
docker compose exec api node scripts/import-whatsapp-lines.cjs
```

El resultado enmascara PID y WABA y no imprime tokens. Deben aparecer todas las líneas configuradas. Si indica que falta una WABA, completar el `WABA_ID_*` correspondiente antes de continuar; no deducirla por nombre ni reutilizar otra.

### 4. Crear el catálogo, sin backfill

```bash
docker compose exec api node scripts/import-whatsapp-lines.cjs --apply
```

El comando es repetible: actualiza por `phone_number_id` y no duplica líneas.

Validación de catálogo:

```bash
docker exec -i mali-whatsapp-postgres psql -U mali_user -d mali_whatsapp <<'SQL'
SELECT
  ba.slug AS area,
  l.legacy_area,
  l.program_key,
  right(l.phone_number_id, 6) AS pid_suffix,
  right(w.meta_waba_id, 6) AS waba_suffix,
  c.secret_source,
  c.secret_ref,
  l.is_default,
  l.active
FROM whatsapp_lines l
JOIN business_areas ba ON ba.id = l.business_area_id
JOIN whatsapp_wabas w ON w.id = l.waba_id
LEFT JOIN meta_credentials c ON c.id = l.credential_override_id
ORDER BY ba.sort_order, l.id;
SQL
```

Para Educación deben verse tres filas bajo el área canónica `educacion`, una sola WABA y los alias heredados `educacion`, `educacion_ca`, `educacion_ep`.

### 5. Backfill de claves opcionales

Ejecutar solo después de validar el catálogo:

```bash
docker compose exec api node scripts/import-whatsapp-lines.cjs --apply --backfill
```

Este paso enlaza:

- conversaciones con su línea heredada;
- campañas con la línea desde la que fueron creadas;
- plantillas con su WABA.

No cambia `area`, no une conversaciones y no fusiona contactos. Las conversaciones antiguas sin `whatsapp_phone_number_id` se asignan por su área heredada; la auditoría previa confirmó que esas conversaciones de Educación no contienen mensajes inbound.

Validación posterior:

```bash
docker exec -i mali-whatsapp-postgres psql -U mali_user -d mali_whatsapp <<'SQL'
SELECT area,
       count(*) AS total,
       count(whatsapp_line_id) AS con_linea,
       count(*) - count(whatsapp_line_id) AS sin_linea
FROM conversations
GROUP BY area
ORDER BY area;

SELECT area,
       count(*) AS total,
       count(whatsapp_line_id) AS con_linea
FROM campaigns
GROUP BY area
ORDER BY area;
SQL
```

### 6. Activar el puente de compatibilidad

Solo después de que catálogo y backfill coincidan con la auditoría:

```env
WHATSAPP_LINE_CATALOG_ENABLED=true
```

Recrear únicamente la API para cargar la bandera:

```bash
docker compose up -d --force-recreate api
docker compose logs --tail=120 api
curl -fsS https://whatsapp.mali.pe/health
```

Con la bandera activa:

- inbound resuelve primero por `phone_number_id` del catálogo;
- cada respuesta usa el token asignado a esa línea, incluso si comparte WABA;
- si una referencia del catálogo no puede resolverse, se conserva el fallback heredado por área;
- las conversaciones nuevas guardan tanto el PID de Meta como `whatsapp_line_id`.

Hacer una prueba inbound y una respuesta manual en Educación, CA y EP. Ante cualquier anomalía, volver la bandera a `false` y recrear solo la API; el `.env` y `app_settings` heredados siguen intactos.

## Condiciones de parada

No continuar al backfill ni al cambio de enrutamiento si ocurre cualquiera de estos casos:

- un mismo `phone_number_id` aparece en dos áreas;
- una línea de Educación apunta a otra WABA inesperada;
- falta el token, PID o WABA de una línea activa;
- el plan no conserva la separación T1/T2 observada en las líneas actuales;
- el healthcheck o una prueba real inbound/outbound deja de funcionar.

## Qué sigue después

1. Hacer que campañas exijan o elijan una línea explícita.
2. Construir la administración central de áreas/WABA/líneas y cifrado de tokens.
3. Recién entonces fusionar `educacion_ca` y `educacion_ep` en los datos de negocio.
4. Añadir las seis líneas nuevas desde la interfaz y retirar gradualmente las variables por línea del `.env`.

El alta/baja y rotación de credenciales debe administrarse desde MALI ONE como plano de control; MALI WhatsApp seguirá siendo el dueño técnico del envío, webhook y validación contra Meta.
