# Plan de transformación: contactos, comunicación y atención

Fecha: 28 de octubre de 2026. Estado: propuesta para implementación; no se han ejecutado migraciones ni cambios funcionales.

## 1. Objetivo y alcance

Separar identidad y perfil del contacto, comunicación y ciclo de atención. La bandeja debe reunirlos sin ser la propietaria de todos sus datos. Conservar las integraciones, permisos, mensajes y registros históricos existentes. MALI ONE continúa siendo responsable del seguimiento posterior.

El plan parte de inspección del repositorio, no de una auditoría de la base desplegada. La presencia de migraciones no demuestra que estén aplicadas en producción. Antes de implementar, levantar inventario de datos y consumidores reales.

## 2. Base existente y cambios necesarios

- `people` ya representa identidad compartida y tiene `mali_one_person_id`. `contacts` contiene fichas por área vinculadas a esa persona y repite algunos datos personales. No equivale hoy a una única fila global de contacto.
- `business_areas` representa áreas y `business_programs` categorías dentro de ellas. `program_id = null` representa General en los filtros actuales. Mantener esta correspondencia; no crear un catálogo paralelo de categorías.
- `contact_programs`, `contact_attributes` y `contact_segments` permiten pertenencia y perfil por categoría.
- `education_lead_cycles` ya tiene contacto, categoría, asesor, estado y calificación. Será la base del lead, evitando introducir otra entidad competidora.
- `education_lead_entries` y `contact_origins` ya registran entradas y procedencia. Separar entrada recibida de oportunidad comercial: varias entradas pueden pertenecer a un ciclo.
- `contacts` también guarda estado/calificación de lead y `conversations` tiene asesor. El servicio de leads sincroniza algunos de estos campos: hay varias ubicaciones para representar una misma responsabilidad.
- La clasificación educativa actual usa 60 días desde la interacción anterior, trata ventas previas como conflicto y agrupa capturas entrantes mediante una ventana de 24 horas. Esas reglas necesitan ajustarse al ciclo explícito, no trasladarse sin revisión.
- Parte del alcance de conversaciones y segmentos se deduce desde la línea. Una modificación futura de la categoría de una línea no debe reclasificar silenciosamente el historial.

## 3. Contrato de producto propuesto

Estas reglas permiten construir un primer alcance concreto. Los valores y excepciones señalados en la sección 12 siguen siendo decisiones pendientes.

1. Contacto es la identidad visible y permanente de una persona. Durante la transición, `people` es la identidad canónica y las filas `contacts` son relaciones técnicas por área. La API y la interfaz deben presentar una ficha coherente y solo los contextos autorizados. Consolidar físicamente esas filas no es requisito de la primera entrega.
2. Existen dos tipos de atributos: contacto y lead. Los atributos del contacto describen a la persona y son compartidos por defecto; pueden tener alcance de área o categoría cuando su significado lo requiera. Los atributos del lead describen exclusivamente una oportunidad y se conservan en ella al cerrar. Tipo, alcance y permisos de edición son decisiones distintas. Los segmentos clasifican contactos por categoría y son independientes de los estados del lead.
3. Propuesta inicial: un lead activo por persona, área y categoría, incluyendo General. La restricción debe operar sobre la identidad canónica para que dos fichas heredadas no permitan dos oportunidades activas accidentales.
4. Una entrada comercial crea o reutiliza un lead activo. No exige línea ni conversación. Una entrada repetida del proveedor no vuelve a crear registros, alertas ni reinicia tiempos.
5. Mientras exista un lead activo del mismo contexto, las nuevas entradas se incorporan a él. Se propone una conversación por contacto y línea utilizada, creada cuando haya comunicación, no anticipadamente por cada línea disponible. Varias conversaciones de una categoría comparten el mismo lead activo, asesor, estado y atributos de atención. Un cambio de línea no crea por sí solo otro lead.
6. Una nueva solicitud comercial después del cierre abre un nuevo lead; no reabre ni sobrescribe automáticamente el anterior. Posventa se difiere a una siguiente etapa: no construir ahora su clasificación ni flujo. Ante un mensaje ambiguo, conservar la comunicación y permitir iniciar una nueva atención explícitamente, sin modificar el ciclo cerrado. Esta regla provisional no constituye detección automática de posventa.
7. Vendido, perdido y vencido cierran el ciclo. Prospecto es una etapa activa, salvo que se defina expresamente como entrega final a MALI ONE. Cerrar una conversación o archivarla no cierra un lead.
8. El asesor, estado, calificación e intereses actuales se leen y editan en el lead. La bandeja y la ficha de lead usan las mismas operaciones.
9. Abrir un chat, responder un bot o enviar una campaña no reclama un lead. Se confirma reclamación automática al responder: si el lead está libre, la primera respuesta humana lo asigna al asesor. Debe ser atómica y abarcar todas sus conversaciones. Responder no cambia al dueño de un lead ya asignado; una transferencia requiere la operación y permisos de reasignación.
10. Todo lead nuevo genera una alerta para usuarios activos con acceso a su categoría. El detalle de mensajes exige además permisos sobre la línea. Sin permiso de notificaciones del navegador, la alerta debe seguir disponible dentro de la aplicación.
11. El cierre conserva todo el historial y no elimina vínculos. El nuevo lead no hereda por accidente estado, calificación, asesor u objeciones del anterior.

## 4. Etapa 0 — inventario y reglas definitivas

Trabajo:

- Revisar migraciones aplicadas y conteos por área/categoría: personas, fichas, ciclos, entradas, estados, atributos y segmentos.
- Inventariar todos los escritores y lectores: formularios Meta/TikTok, mensajes entrantes, respuestas de asesores, flujos automáticos, importación, edición masiva, CRM, Prospectia, campañas, reportes y exportaciones.
- Ubicar cada atributo existente en contacto o lead y documentar su alcance. Ejemplos: profesión → contacto compartido; curso de esta consulta, convocatoria y objeción → lead. Registrar decisiones por definición, no por coincidencia de nombres. La separación de producto está cerrada; consultar únicamente casos ambiguos del catálogo real.
- Conservar segmentos del contacto por categoría y estados de lead como conceptos independientes. No presuponer que los segmentos existentes representan estados ni convertir etiquetas antiguas en resultados históricos sin evidencia.
- Identificar datos personales divergentes entre `people` y sus fichas. Definir precedencia y revisión de conflictos; no fusionar personas distintas por compartir teléfono.
- Definir estados terminales, inactividad y categorías de ingreso. Aplicar reclamación al responder y diferir el flujo de posventa; documentar la regla provisional de mensajes ambiguos.

Entrega: inventario, mapa de datos, reglas y ensayo de migración sin escritura. Criterio de salida: todos los campos y consumidores tienen destino y los conflictos quedan identificados.

## 5. Etapa 1 — ampliar el modelo sin retirar lo existente

Trabajo:

- Ampliar el ciclo actual con identidad canónica, cierre (`closed_at`, motivo), vencimiento y marcas de atención. Conservar IDs y referencias de los ciclos existentes. El nombre físico `education_lead_cycles` puede mantenerse inicialmente; exponer el concepto Lead desde el servicio y la API.
- Definir una operación de cierre transaccional que mantenga consistentes estado terminal y fecha de cierre. Impedir un lead activo en estado terminal y viceversa.
- Añadir una restricción de unicidad para el lead activo por persona, área y categoría. General requiere un índice específico o tratamiento explícito de nulos. Resolver duplicados heredados antes de activar la restricción.
- Añadir definiciones y valores de atributos de lead, reutilizando tipos y validadores actuales. El valor referencia un lead y una definición; la categoría de la definición debe corresponder a la del lead. Unicidad por lead y definición.
- Mantener los valores de perfil actuales durante la transición y adaptar sus definiciones al alcance compartido, por área o por categoría según corresponda. Los atributos compartidos deben resolverse desde la identidad canónica, sin mantener valores independientes por ficha heredada; definir su almacenamiento y unicidad por persona y definición en la migración aditiva. Los atributos contextuales mantienen alcance explícito. La administración muestra dos tipos: Contacto y Lead; configura alcance y permisos por separado. Cambiar el destino de una definición ya usada requiere migración explícita. Crear/configurar campos y editar sus valores son permisos distintos.
- Añadir una relación histórica lead–conversación con inicio y fin de vinculación. Un lead puede atenderse en varias conversaciones y una conversación puede participar en varios ciclos sucesivos. Evitar una relación única que se sobrescriba en cada reingreso.
- Conservar evidencia de qué mensajes corresponden a cada ciclo, mediante referencia explícita o asociaciones de mensajes. Los intervalos de vinculación sirven para navegación, pero no deben atribuir ambiguamente mensajes tardíos.
- Persistir el contexto de categoría de la atención y su procedencia. No recalcular el contexto histórico desde la configuración actual de la línea. Una transferencia de categoría debe ser explícita y auditada.
- Registrar eventos de asignación, estado, cierre y cambios relevantes; reutilizar auditoría existente donde permita consultar por lead.

Entrega: migración aditiva y contratos API. Criterio de salida: el modelo admite formulario sin chat, varios ciclos históricos y atención por varias líneas sin pérdida de contexto.

## 6. Etapa 2 — servicio único de atención e ingresos

Trabajo:

- Centralizar en un servicio: resolver contexto, registrar entrada, obtener/crear lead activo, vincular conversación, reclamar/asignar, actualizar atributos, cambiar estado y cerrar/vencer.
- Conectar formularios, mensajes entrantes, flujos e integraciones a ese servicio. Mantener payload de origen y clave idempotente por evento externo.
- Resolver identidad antes de abrir la oportunidad. Si hay conflicto, conservar la entrada para revisión sin atribuirla arbitrariamente a una persona.
- Resolver categoría desde el enrutamiento de formulario o línea al ingresar. Los casos sin categoría deben seguir una regla explícita: General si corresponde o pendientes de clasificación; no elegir una categoría por defecto que conceda acceso indebido.
- La selección del lead activo y su creación deben ser transaccionales y respaldadas por la restricción de base. Probar formulario y mensaje concurrentes para la misma persona.
- Hacer que las mutaciones de atención reciban `lead_id`; no buscar simplemente el último ciclo del contacto. Validar que está activo, que corresponde al contexto y que el actor tiene acceso.
- En primera respuesta humana, coordinar reclamación y envío: resolver el ganador antes de enviar y registrar la primera respuesta solo cuando el proveedor acepte el envío. Si falla el envío, no contar atención exitosa; definir cómo se muestra/reintenta conservando la asignación.
- La asignación manual requiere permisos y el asesor destino debe tener acceso al contexto. No propagar la asignación a otras categorías ni convertirla en propiedad permanente de la persona.
- Revisar asignación automática heredada de Prospectia y asesor anterior. Conservarla solo como política explícita, compatible con reclamación y reasignación.
- Ejecutar vencimientos de manera idempotente. Mensajes automáticos y campañas no renuevan por sí solos la actividad comercial.
- El ciclo será la fuente autoritativa. Los campos antiguos podrán funcionar temporalmente como proyecciones de compatibilidad cuando su contexto sea inequívoco. Un solo estado en contacto no puede representar varias categorías activas: los consumidores ambiguos deben migrarse antes de activar esos casos.

Entrega: flujos operativos y API de atención. Criterio de salida: no se generan ciclos duplicados, no se modifican otros contextos y no se resucitan ciclos cerrados por eventos tardíos.

## 7. Etapa 3 — interfaz: perfil, lead y mensajes

Trabajo:

- Contactos: información personal y atributos compartidos, atributos contextuales de área/categoría cuando correspondan y acceso al historial de oportunidades. Centralizar edición de identidad en `people` y actualizar proyecciones heredadas desde una sola operación auditada.
- Leads: lista con una fila por oportunidad, incluyendo leads sin chat; las entradas/fuentes quedan en su detalle. Los conteos de entradas deben distinguirse de los conteos de leads.
- Detalle del lead: asesor, estado, calificación, atributos de atención, origen/entradas, tiempos y conversaciones relacionadas.
- Bandeja: separar visualmente Perfil del contacto y Atención actual. Ambos editables desde ahí según permisos, sin duplicar reglas.
- Sin lead activo: permitir comunicación y mostrar una acción para iniciar una nueva atención cuando corresponda. No mostrar al asesor de un lead cerrado como propietario actual.
- Historial: consultar leads cerrados con atributos y responsables de cada momento. No poblar su detalle con los atributos actuales de otro ciclo.
- Atributos: separar catálogos de perfil y atención. Segmentos: mantener clasificación del perfil por categoría.

Componentes de partida: `ContactDetailPage.tsx`, `ContactForm.tsx`, `LeadsHubPage.tsx`, `ConversationsInboxPage.tsx`, `InboxContactSheet.tsx`, `InboxAssignDialog.tsx` y administración de atributos.

Entrega: recorrido completo desde formulario o chat hasta cierre y reingreso. Criterio de salida: editar desde ficha o bandeja produce el mismo resultado y el usuario distingue perfil de oportunidad.

## 8. Etapa 4 — alertas, tiempos, campañas e integración

Trabajo:

- Emitir el evento de nuevo lead después de confirmar la transacción; usar un registro de eventos pendientes de entrega o mecanismo equivalente para reintentar sin perder alertas. Deduplicar por lead y tipo de evento.
- Filtrar destinatarios de alertas por área/categoría y permisos vigentes. No exponer contenido de líneas no autorizadas. Revisar el mecanismo actual de avisos de bandeja, que no sustituye necesariamente la alerta de todo nuevo lead.
- Guardar creación, primera asignación, primera gestión humana, primer mensaje entrante del ciclo, primera respuesta humana y cierre. Una reasignación no borra la primera asignación.
- Medir tiempos de asignación y primera gestión desde creación; tiempo de primera respuesta desde el primer entrante del ciclo. Para formularios sin chat, el tiempo de respuesta es no aplicable, no cero.
- Propuesta inicial: medir tiempo transcurrido y conservar timestamps para incorporar horario laboral después. Bots, campañas, importaciones y lecturas de pantalla no cuentan como atención humana.
- Campañas: permitir combinar segmentos, atributos y estados de lead. Distinguir explícitamente estado del lead activo de resultados de leads anteriores, con opción de excluir contactos con atención activa en la categoría seleccionada. Los filtros sobre atributos y estado de una oportunidad deben corresponder al mismo lead, no combinar accidentalmente datos de ciclos diferentes. Ejemplo: tuvo lead perdido en una categoría y no tiene uno activo en esa categoría. Conservar consentimiento, exclusiones, deduplicación por persona y alcance autorizado.
- Actualizar reportes y exportaciones para distinguir contactos, leads y entradas. Definir si un informe consulta el resultado de cada ciclo o la situación vigente.
- Adaptar contrato CRM/MALI ONE con identidad de persona, lead, contexto, resultado y datos de atención. Usar una clave idempotente para la entrega y separar estado de transferencia del resultado comercial. Un fallo de sincronización no debe perder el cierre ni repetir una venta.

Entrega: métricas, alertas y consumidores externos coherentes con el nuevo modelo. Criterio de salida: reintentos no duplican alertas/entregas y ningún consumidor obtiene un estado ambiguo del contacto.

## 9. Etapa 5 — migrar datos y activar gradualmente

Orden:

1. Preparar respaldo verificable y ejecutar ensayo sobre una copia con el mismo esquema desplegado.
2. Aplicar ampliaciones aditivas. Mantener una sola ruta autoritativa de escritura por cohorte; no ejecutar dos motores que creen leads para la misma entrada.
3. Migrar por lotes idempotentes con registro de origen, versión de migración y valores copiados. Mantener IDs históricos y relaciones externas.
4. Completar identidad/contexto de ciclos desde evidencia. Si falta categoría, fecha de cierre o atribución confiable, registrar incertidumbre para revisión; no fabricar una precisión histórica inexistente.
5. Copiar atributos de atención actuales únicamente al ciclo que la evidencia permita identificar. No copiarlos a todos los ciclos pasados. Conservar los valores originales y su procedencia hasta validar la migración.
6. Si varias fichas/ciclos compiten por el mismo activo, enviar el caso a revisión. No resolver el conflicto eliminando registros ni escogiendo al último asesor sin criterio.
7. Conciliar conteos, vínculos, valores y permisos. Probar ejecución repetida y recuperación de lotes interrumpidos. Definir captura de escrituras concurrentes o una pausa breve controlada para el cambio final.
8. Activar primero un área/categoría piloto, incluyendo General en las pruebas de alcance. Después habilitar otras cohortes. El motor actual está especializado en Educación; su extensión a otras áreas debe ser explícita, no una activación global accidental.
9. Observar errores, creación duplicada, alertas, asignaciones y tiempos; comparar lecturas nuevas y anteriores donde los modelos sean equivalentes.

Reversión: apagar la funcionalidad nueva o volver a una versión compatible con el esquema ampliado, preservando datos y eventos pendientes. No volver sin más a un binario anterior que no entienda los nuevos ciclos. No eliminar tablas/columnas mientras dure el periodo de validación.

Entrega: acta de conciliación y piloto validado. Criterio de salida: históricos preservados y operación completa de cada cohorte sin discrepancias pendientes de alto impacto.

## 10. Etapa 6 — retirar dependencias antiguas

- Eliminar escritores y lectores de estado/calificación comercial en contacto y de propietario comercial en conversación.
- Si sigue siendo necesario enrutar chats sin lead, definirlo como responsabilidad de comunicación separada; no reutilizarlo implícitamente como propiedad comercial.
- Retirar proyecciones/columnas antiguas solo cuando todos los consumidores, reportes e integraciones estén migrados y haya transcurrido el periodo de recuperación.
- Unificar nombres de servicios y modelos cuando aporte claridad; un renombrado físico masivo no es requisito inicial.
- Evaluar consolidación física de fichas por área como tarea separada. La experiencia de contacto único y la identidad canónica sí forman parte de este plan.

## 11. Validación obligatoria para implementación

Probar, como mínimo:

1. Formulario sin mensaje: crea/reutiliza contacto y abre lead sin conversación.
2. Formulario y WhatsApp concurrentes en la misma categoría: una oportunidad y dos entradas válidas.
3. Reentrega del mismo evento: ninguna duplicación ni reinicio de métricas.
4. Dos categorías simultáneas: estados, asesores y atributos independientes, incluyendo General.
5. Dos asesores reclaman a la vez: un ganador; el perdedor conoce el resultado antes de enviar.
6. Envío humano fallido: no se registra primera respuesta exitosa. Bot/campaña no reclama ni cuenta como atención.
7. Venta o pérdida y nueva consulta comercial: nuevo ciclo; el anterior conserva curso, resultado y asesor.
8. Mensaje ambiguo después del cierre: conversación disponible, ciclo anterior intacto y acción explícita de nueva atención; clasificación de posventa fuera de esta entrega.
9. Cambio de línea y eventos tardíos: contexto e historia preservados, sin contaminar el lead siguiente.
10. Vencimiento concurrente con nueva actividad: resultado consistente y auditable.
11. Acceso restringido: ficha compartida no expone perfiles, leads, alertas o mensajes de contextos no autorizados.
12. Migración repetida/interrumpida: mismos registros y valores, sin duplicados ni pérdida de vínculos.
13. Campañas y exportaciones: audiencia autorizada y conteos por entidad correctos.
14. CRM/MALI ONE: entrega repetida y fallo temporal no duplican gestiones externas.

Ejecutar pruebas unitarias de políticas, pruebas de integración sobre restricciones y concurrencia reales de PostgreSQL y recorrido de interfaz. Las simulaciones de servicio por sí solas no prueban exclusión concurrente. Compilar API y web. Establecer primero el estado base de las suites para distinguir fallos previos. Para este documento no se ejecutaron pruebas de aplicación, porque no modifica comportamiento.

## 12. Decisiones y recomendaciones actualizadas

- Concurrencia comercial: recomendación alineada con la preferencia del usuario: un lead activo por persona/área/categoría, con una conversación por cada línea utilizada. Cada conversación conserva sus mensajes; todas muestran la misma atención activa. No crear chats vacíos por cada línea. Varios cursos pueden registrarse como intereses de ese lead, pero este alcance ofrece un responsable y un resultado global; ventas paralelas con resultados independientes necesitarían un modelo posterior.
- Caducidad recomendada: 60 días calendario de inactividad del interesado, configurable por categoría, con 60 como valor por defecto. Es una decisión inicial de continuidad con la ventana existente, no un plazo óptimo demostrado por datos. Contar desde la creación si aún no existe actividad posterior; renovar con un nuevo mensaje o formulario comercial válido del interesado dentro del ciclo. Campañas, bots, mensajes salientes del asesor y ediciones de ficha no renuevan el plazo. Venta o pérdida cierran de inmediato, aunque no hayan transcurrido 60 días. Guardar el plazo aplicado al ciclo; los cambios de configuración afectan nuevos ciclos salvo recálculo explícito y auditado de los activos.
- Reclamación confirmada: automática al responder si el lead está libre. Abarca el lead completo, no solo la conversación desde la que se responde. Mantener asignación manual autorizada. La primera respuesta humana se contabiliza cuando el proveedor acepta el envío; la reserva de asignación previa evita carreras. Si falla el envío, mostrar el fallo y conservar la asignación para reintento, sin registrar atención exitosa.
- Posventa confirmada fuera de alcance: siguiente etapa. Conservar mensajes y ciclos cerrados; usar la regla provisional de nueva atención explícita ante intención ambigua. No incorporar automatización de clasificación ni nuevos estados de posventa.
- Punto 5 cerrado: dos tipos de atributos, contacto y lead. Los de contacto permanecen entre oportunidades, son compartidos por defecto y admiten alcance de área/categoría cuando corresponda. Los de lead se conservan en su oportunidad al cerrar. Segmentos del contacto por categoría y estados comerciales del lead permanecen independientes. Campañas puede combinar segmentos, atributos y estados, distinguiendo atención activa e historia. La tarea restante es mapear el catálogo real y resolver únicamente datos ambiguos, no reabrir esta decisión de producto.
- Fuera de esta fase por decisión del usuario: “Cursos consultados” o “Historial de intereses” como resumen agregado en la ficha del contacto. No construir su cálculo, lista ni filtros derivados ahora. Se mantiene el curso/interés propio de cada lead y la consulta de sus registros históricos individuales.

Pendientes de detalle: mapa de catálogos reales, catálogo terminal y momento de traspaso a MALI ONE, prioridad de asesor anterior y papel de Prospectia. La coordinación de acceso a distintas líneas debe respetar los permisos: reclamar el lead no concede acceso automático a todas sus conversaciones. Las recomendaciones de plazo y concurrencia quedan documentadas como propuesta; las decisiones explícitas de reclamación y posventa quedan incorporadas. Esto no autoriza migraciones en producción.

## 13. Orden de entregas revisables

1. Inventario, reglas y ensayo de migración.
2. Esquema aditivo y contratos de dominio.
3. Servicio de ingreso/ciclo, idempotencia y pruebas de concurrencia.
4. Asignación, cierre, vencimiento y separación de atributos.
5. Ficha, lista de leads y bandeja sobre la misma API.
6. Alertas, métricas, campañas, reportes y contrato CRM.
7. Migración conciliada y activación piloto.
8. Expansión a contextos restantes y retiro del legado.

El cambio funcional puede prepararse en entregas pequeñas, pero el piloto exige que estén cubiertos todos los consumidores de ese contexto. No activar solo la interfaz dejando ingresos o integraciones escribiendo con reglas anteriores.

## 14. Referencias del repositorio

- Modelo: `api/prisma/schema.prisma`.
- Identidad: `api/src/people/person-resolver.service.ts`.
- Categorías/permisos: `api/src/config/category-scope.ts`, `api/src/config/business-scope.ts`, `api/src/business-model/`.
- Ciclos/ingreso: `api/src/leads/education-lead-workflow.service.ts`, `education-lead-classification.util.ts`, `leads.service.ts`, `meta-leadgen.service.ts`, `tiktok-leadgen.service.ts`.
- Perfil: `api/src/contacts/`, `api/src/attribute-definitions/`, `api/src/segments/`.
- Comunicación: `api/src/conversations/`, `web/src/features/conversations/`.
- Integraciones/consumidores: `api/src/crm/`, `api/src/campaigns/`, `api/src/reports/`, `docs/campaign-category-audience.md`.

Los nombres propuestos de nuevos campos y relaciones son decisiones de diseño de este plan, no afirmaciones de que ya existan.
