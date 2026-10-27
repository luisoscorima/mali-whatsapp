# Revisión de la migración área → categorías → líneas

Fecha: 27 de octubre de 2026. Revisión del código local, compilación y pruebas aisladas. No se consultó la base de producción ni se enviaron mensajes a Meta.

## Dictamen

La migración está implementada parcialmente. El modelo admite múltiples líneas, la identidad de conversación incorpora la línea y el envío conserva su Phone Number ID. Sin embargo, no está cerrada la separación por categoría en autorización, resolución de atributos y plantillas. Tampoco está generalizada a todas las áreas la experiencia de categorías.

P1 = corregir con prioridad por acceso indebido o contenido/envío incorrecto. P2 = error funcional relevante para crecimiento o consistencia.

## 1. [P1] El acceso por ID evade el alcance de categorías

**Evidencia:** `api/src/campaigns/campaigns.service.ts:598`, `:1451`; `api/src/flows/flows.service.ts:533`, `:571`.

El listado de campañas aplica `campaignAudienceSql` y el listado de flujos aplica `programScopeWhere`, pero el detalle/reintento de campaña y la actualización/eliminación de flujo solo verifican `{ id, area }`. El interceptor almacena el alcance en AsyncLocalStorage; no añade restricciones automáticamente a Prisma.

**Caso:** un usuario restringido a CA, con el permiso de módulo necesario, solicita directamente el ID de una campaña o flujo EP dentro de Educación. Puede acceder al detalle y sus destinatarios o ejecutar operaciones que el listado le ocultaba. El script de revisión confirma que un usuario restringido alcanza el reintento usando solamente ID y área.

**Corrección:** autorización de recursos centralizada y obligatoria para detalle, exportación, actualización, eliminación, reprogramación y reintento; aplicar categoría y, cuando corresponda, línea. Añadir pruebas con usuarios CA/EP y llamadas directas por ID.

## 2. [P1] Las plantillas siguen identificadas por área, no por WABA

**Evidencia:** `api/src/templates/templates.service.ts:361`, `:389`; `api/src/campaigns/campaigns.service.ts:1204`; `api/src/conversations/conversations.service.ts:1075`; `api/prisma/schema.prisma` (modelo `whatsapp_templates`).

La sincronización toma las credenciales predeterminadas del área y realiza upsert por `(area, name, language)`. No completa `whatsapp_waba_id` ni separa el catálogo por WABA. La creación de campaña valida la plantilla por área y elige la línea por separado; el envío usa esa línea sin validar compatibilidad de WABA.

**Caso:** dos líneas de Educación pertenecen a WABA distintos. El selector ofrece las plantillas del WABA predeterminado también para la segunda línea. Puede fallar el envío; si existe el mismo nombre en ambos WABA con contenido distinto, la vista previa no garantiza el contenido real. Sincronizar después de cambiar el predeterminado puede reemplazar/eliminar las filas del catálogo anterior.

**Corrección:** identidad de plantilla por WABA/nombre/idioma, backfill del WABA, sincronización por WABA y filtrado/validación según la línea elegida tanto en campañas como en inbox.

**Validación:** seguimiento estático del flujo completo; no se hicieron llamadas a Meta.

## 3. [P1] Las variables de plantillas mezclan atributos de categorías distintas

**Evidencia:** `api/src/campaigns/contact-template-params.util.ts:13` y `:26`. Consumidores: envío masivo, reintentos y envío desde conversación.

La BD ya permite varias filas `(contact_id, program_id, attr_key)`, pero `fetchContactAttributesMap` carga todos los programas y reduce el resultado a `map[contact_id][attr_key]`. La última fila sobrescribe a las anteriores y no existe un orden que permita seleccionar la categoría correcta.

**Caso reproducido:** un contacto con `curso` CA y `curso` EP termina con el valor EP en el mapa compartido. Una plantilla enviada desde CA puede usar información de EP.

**Corrección:** resolver atributos usando la categoría de la línea y una política explícita para atributos generales. Conservar el mismo contexto en vista previa, cola y reintento. No basta con ordenar las filas.

## 4. [P2] La base rechaza ajustes de una categoría nueva

**Evidencia:** `api/prisma/migrations/20260702120000_init/migration.sql:465`; `api/src/settings/settings.service.ts:85` y `:126`.

La API acepta claves como `educacion_norte` y las pantallas generan ese identificador. Sin embargo, después de aplicar todas las migraciones permanece `app_settings_area_check`, que solo permite las seis áreas originales y `global`.

**Caso reproducido:** insertar ajustes IA para `educacion_norte` devuelve SQLSTATE `23514`. También afecta horarios que se guardan con la misma clave de ámbito.

**Corrección:** nueva migración para un ámbito de ajustes basado en área/categoría del catálogo, manteniendo una ruta de compatibilidad y un alcance global explícito. Verificar alta, edición y uso real de una categoría nueva.

## 5. [P2] Las respuestas de campaña se atribuyen a cualquier línea del área

**Evidencia:** `api/src/campaigns/campaign-responders.util.ts:149` y `:198`.

La unión con conversaciones utiliza área y destinatario, pero no `campaign.whatsapp_line_id`. La agregación agrupa por conversación y cuenta filas como personas que respondieron.

**Caso reproducido:** campaña enviada por línea 100; el contacto responde exclusivamente en línea 200. El indicador devuelve una respuesta y enlaza la conversación 200. Si responde en varias líneas, también puede contarse varias veces.

**Corrección:** asociar respuestas a la línea emisora, conservar una política explícita para campañas históricas sin línea y deduplicar destinatarios según la identidad definida.

## 6. [P2] Mover una línea deja conversaciones en dos filtros de categoría

**Evidencia:** `api/src/whatsapp-admin/whatsapp-admin.service.ts:762`; `api/src/config/business-scope.ts:42`.

La acción específica para mover categoría modifica `program_id`, `program_key` y `legacy_area` de la línea sin modificar las áreas históricas de sus conversaciones. El predicado de categoría acepta el alias histórico de la conversación **o** la categoría actual de su línea.

**Caso reproducido:** conversación con `area=educacion_ca`, cuya línea ahora pertenece a EP, aparece tanto con filtro CA como con filtro EP. Para usuarios restringidos, el control adicional de líneas puede ocultarla en CA: dos usuarios observan resultados inconsistentes. La acción también permite mover líneas con historial, mientras la edición general prohíbe modificar esa identidad.

**Corrección:** definir si la categoría del historial es inmutable o sigue a la línea. Usar una sola fuente de verdad; si se mueve, realizar una operación coherente y transaccional. Limitar el fallback por alias a registros sin identidad de línea.

## 7. [P2] Las categorías no están generalizadas a todas las áreas

**Evidencia:** `web/src/shared/area/useCategoryScope.ts:37`; `web/src/features/admin/AdminAreasPage.tsx:46`, `:96`; `api/src/conversations/conversations.service.ts:853`; `api/src/campaigns/campaigns.service.ts:1191`.

La base y el endpoint de creación permiten categorías por área, pero la interfaz de administración crea y consulta siempre categorías de Educación; el hook de selección y el catálogo del inbox solo se activan en Educación. El envío de campañas descarta el filtro de categorías fuera de Educación.

**Caso:** crear dos categorías de PAM mediante la API no permite gestionarlas ni operar sus filtros con la misma experiencia de Educación.

**Corrección:** parametrizar el catálogo y los selectores por área canónica. Separar las reglas de negocio propias de Educación del mecanismo genérico de categorías y líneas.

**Criterio:** este hallazgo toma literalmente el modelo solicitado: N categorías por área. Si el alcance de esta versión era exclusivamente Educación, sigue siendo una limitación pendiente, no un impedimento para ese alcance reducido.

## Verificación ejecutada

- `npm run build -w api`: aprobado.
- `npm run build -w web`: aprobado. Vite advierte que Node 20.17.0 está por debajo de su mínimo 20.19+ / 22.12+.
- `npm test -w api -- --runInBand`: 33 suites, 29 aprobadas y 4 fallidas; 173 pruebas, 161 aprobadas y 12 fallidas.
- `node scripts/review-multiline.cjs`: aplica 52 migraciones en PGlite y reproduce cinco defectos sin acceder a la base de la aplicación.

Suites fallidas:

- `webhook.service-bsuid.spec.ts`: 5 fallos; el mock no ofrece `$executeRaw`.
- `campaign-recipients.util.spec.ts`: 2 fallos; los casos de envío no proporcionan la línea que ahora se exige.
- `conversation-pagination.spec.ts`: 3 fallos; el contexto de área usado por las pruebas no supera la nueva validación del catálogo.
- `education-crm.spec.ts`: 2 fallos; falta un modelo con `findFirst` en el mock.

Estos fallos no equivalen por sí mismos a doce errores de producción. Sí impiden considerar verde la suite y dejan sin verificar esas rutas tras la migración.

## Cobertura y límites

Se siguió el flujo catálogo/migraciones → permisos → webhook/identidad → inbox/envío → campañas/colas/reintentos → plantillas/atributos → categorías de segmentos/flujos/leads → ajustes/reportes y administración web. Se comprobaron, entre otros, la unicidad de conversación por línea y destinatario, el envío con Phone Number ID del hilo, el archivado por línea en campañas y los flujos por `program_id`.

No se ejecutó una prueba end-to-end en navegador con sesiones reales, ni se certificó el estado de datos migrados de producción. La aplicación de migraciones sobre una base vacía no demuestra una migración segura con todos los datos históricos. Quedan por validar, con una copia anonimizada, backfill de líneas, contactos duplicados, pertenencias y conflictos de identidad.

## Secuencia de corrección

1. Cerrar autorización por recurso y aislar atributos antes de nuevos envíos.
2. Completar identidad WABA de plantillas y su compatibilidad con líneas.
3. Reparar ajustes de nuevas categorías y definir semántica de movimiento de líneas.
4. Corregir atribución de respuestas y generalizar categorías por área.
5. Actualizar fixtures de pruebas y ejecutar una matriz funcional: dos áreas, dos categorías por área, dos líneas por categoría, contacto compartido, usuarios restringidos, WABA distintos, línea inactiva y campañas programadas/reintentadas.

No se modificó código funcional ni se aplicaron correcciones de producto en esta revisión. Solo se añadió este informe y el script de reproducción.
