# Audiencia de campañas por categoría

Las operaciones `POST /campaigns/recipients-preview` y `POST /campaigns/send`
aceptan el mismo query string `category` que las listas:

- `category=general`: asignaciones con `program_id IS NULL`.
- `category=ca` o `category=ep`: asignaciones del programa correspondiente.
- `category=ca&category=ep`: unión de ambas categorías.
- Sin `category`: todas las categorías del área.

El slug se interpreta dentro de las categorías seleccionadas. Si un mismo slug
existe en CA y EP y ambas están seleccionadas, se incluyen ambas audiencias.
El formulario muestra una opción por slug con las categorías correspondientes.
Cambiar las categorías del riel invalida la previsualización y sus selecciones.

La definición y la asignación de segmento deben coincidir en área, slug y
`program_id`, incluyendo la igualdad de valores nulos para General. Las
exclusiones por segmento usan el mismo alcance. Los IDs enviados explícitamente
se intersectan con esa audiencia; no permiten saltarse el filtro.

El conteo y la lista se deduplican por `person_id`; se conserva la ficha elegible
con menor ID. Las exclusiones de contactos y segmentos se aplican a la persona
dentro del área, incluso si existe más de una ficha. No se deduplican personas
distintas por teléfono ni se resuelven conflictos de identidad automáticamente.

Los alias `educacion_ca` y `educacion_ep` consultan las fichas canónicas de
Educación y fijan su respectiva categoría. PAM, Patronato y TI conservan su
audiencia por área e ignoran los filtros de categorías de Educación.

La selección se guarda en `campaign_payload.categories`, junto con los IDs de
destinatarios, para conservarla al ejecutar y reanudar campañas programadas.
El worker usa el mismo filtro. Los reintentos de envíos fallidos trabajan con los
logs existentes, no reconstruyen una nueva audiencia por slug.

## Verificación local

`npm test -w api -- --runInBand campaign-recipients.util.spec`

Ejecuta 17 pruebas con PostgreSQL en memoria mediante PGlite. No lee
`DATABASE_URL`, no envía mensajes y no modifica bases externas. Incluye General,
CA, EP, selección múltiple, alias, exclusiones, consentimiento, actividad,
ventana de servicio, deduplicación por persona, otras áreas, previsualización,
persistencia inmediata/programada y reconstrucción en el worker.

API y web compilaron. La suite completa terminó con 135 pruebas aprobadas y seis
fallos en tres suites: `conversation-pagination`, `education-crm` y
`meta-settings.service`. Los mismos seis fallos se reprodujeron sobre una copia
del commit original `c11c0a6`, sin estos cambios. No se corrigieron en esta etapa.
La compilación web advierte que Node 20.17.0 es inferior al mínimo de Vite
(20.19+ o 22.12+), aunque finalizó correctamente.

## Migraciones y comprobaciones antes del despliegue

La inspección del código confirmó:

- `20261025010000_business_model_identity_access` agrega categoría a atributos,
  orígenes, entradas y ciclos de leads.
- `20261026020000_category_on_segments_and_flows` agrega categoría a definiciones,
  asignaciones de segmentos y flujos, con índices separados para General.
- `20261026030000_category_catalogs_and_leads` mueve los catálogos de los alias a
  Educación y completa categorías de leads desde formularios y líneas.
- Las listas de segmentos, atributos, flujos y leads ya consumen filtros de
  categoría. Esta corrección de audiencia no modifica migraciones.

No se verificó el estado real de producción. La configuración local apunta al
host Docker `postgres`, Docker no está activo y no se encontró un destino de
acceso remoto configurado. Antes de desplegar, comprobar en el servidor el
commit activo, `_prisma_migrations` y los conteos de catálogos/leads por categoría.
No interpretar la existencia de los archivos como evidencia de su aplicación.

Revisar también campañas antiguas pendientes: si su payload no tiene
`categories`, conserva el comportamiento compatible de todas las categorías.
No es posible inferir con certeza qué categorías se seleccionaron originalmente.
No ejecutar esas campañas como prueba de aislamiento sin revisar su audiencia.

No se desplegó, no se ejecutaron migraciones ni scripts de consolidación o
restauración, y no se alteraron el ensayo, los respaldos ni los conflictos.
