# Ensayo local de lifecycle — 29 de octubre de 2026

Resultado: migración validada en una copia de producción; activación del piloto todavía bloqueada por conflictos de datos y fallos reproducidos del workflow.

## Alcance y aislamiento

- Producción se utilizó únicamente para consultas y `pg_dump`, sin despliegues, cambios de datos, migraciones ni activación del flag.
- Copia consistente obtenida por SSH y guardada en `backups/leads-rehearsal-20261029/production.dump` (carpeta excluida de Git).
- SHA-256 del dump: `064ca2904c950d47b93103e726e62e52039543d73594860ba7664489dc0aca56`.
- Restauración en PostgreSQL 16 local, base `leads_rehearsal`, contenedor `mali-leads-rehearsal-20261029`.
- Red Docker `mali-leads-rehearsal-20261029`, con `Internal=true`. No hay puerto publicado efectivo.
- Contenedor auxiliar `mali-leads-rehearsal-tools-20261029` con entrada `sleep`; ejecuta exclusivamente las herramientas solicitadas. No se arrancaron API, Redis, trabajadores ni integraciones.
- El flag real quedó ausente tanto en la copia como en producción. Para las pruebas de dominio se sustituyó su lectura en memoria, sin guardar la configuración.
- El directorio `backups` contiene datos de producción: no agregarlo a Git ni publicarlo. Las exportaciones de revisión usan identificadores, no nombres/teléfonos de clientes.

## Migración y diagnóstico

`prisma migrate deploy` aplicó correctamente `20261028120000_leads_additive_lifecycle`. Una segunda ejecución terminó con `No pending migrations to apply`.

La copia contiene 16.760 ciclos. Después de migrar quedan 16.729 abiertos y 31 cerrados por estados terminales existentes. No faltan personas asociadas. Hay 1.898 ciclos abiertos sin estado.

El backfill se ejecutó sin `--alerts`: cero alertas creadas. No se aplicó ninguna resolución de conflictos ni lote de vencimientos.

La versión de migración ensayada ya deja `inactivity_deadline_at` nulo en los históricos. Por eso hay 3.748 candidatos históricos por más de 60 días de inactividad, pero **cero ciclos elegibles para vencimiento automático inmediato**. Se exportan por separado para revisión. No se reinició artificialmente la última interacción.

## Cola de conflictos

Se confirmaron 188 grupos con 376 ciclos abiertos competidores.

El conteo anterior de 19 grupos usaba diferencias entre valores no nulos. `COUNT(DISTINCT ...)` ignora nulos: no detecta, por ejemplo, un ciclo sin asesor frente a otro asignado, o uno sin estado frente a otro con estado.

Al tratar esos casos como diferencias reales:

- 123 grupos requieren revisión manual por asesor o estado diferente, incluyendo ausencia de valor.
- Distribución manual: CA 20, EP 39, General 64.
- 65 grupos son candidatos provisionales con la misma gestión. No se cerraron: aún deben validarse procedencia e información relevante antes de aprobar una resolución.
- El clasificador también revisa diferencias de calificación, ficha, falta de entradas y solapamientos de periodos. Son indicios para revisión, no una autorización de cierre automático.

Archivos en `backups/leads-rehearsal-20261029/`:

- `conflicts-all.csv`: 188 grupos completos, con evidencia de sus ciclos.
- `conflicts-manual.csv`: 123 grupos manuales.
- `conflicts-manual-details.csv`: 246 filas, una por ciclo de la cola manual, con contexto, asesor/estado, fechas y entradas.
- `conflicts-management.csv`: diferencias de gestión contando valores ausentes.
- `conflicts-candidates.csv`: 65 candidatos provisionales, sin cambios aplicados.
- `expiry-candidates.csv`: 3.748 históricos candidatos a vencimiento separado.
- `audit-summary.json`: conteos y estado del flag/alertas.

## Validaciones ejecutadas

- 37 pruebas unitarias, 8 suites de `src/leads/`: aprobadas.
- `tsc --noEmit -p api/tsconfig.build.json`: aprobado.
- Pruebas del workflow sobre PostgreSQL real, con fixtures dentro de una transacción revertida: dos categorías producen leads distintos; repetir inicio reutiliza el ciclo; CTA sin mensaje mantiene primer inbound nulo; primer reclamo gana; otro asesor no toma el lead; orgánico después del cierre no abre otro; flag apagado bloquea inicio; históricos no vencen automáticamente.
- La prueba del segundo asesor es secuencial; no reemplaza una prueba completa de concurrencia entre conexiones.
- La creación de un índice único de prueba fue rechazada por los conflictos existentes, como corresponde. Se revirtió la transacción; los índices diferidos no quedaron instalados.
- La base conservó sus 188 conflictos, cero alertas y flag ausente al terminar. No quedaron personas de prueba. Las secuencias locales pueden avanzar por las inserciones revertidas; no afecta producción.

## Hallazgos reproducidos que bloquean la activación

1. **La reclamación afecta conversaciones de otra categoría.** Crear dos leads de la misma persona en CA y EP, cada uno con su conversación, y reclamar CA también asigna la conversación EP. `reserveClaim` proyecta por área/contacto sin restringir categoría ni vínculos del lead. Limitar la proyección al contexto de la oportunidad y conservar las demás conversaciones.
2. **El cierre no termina la vigencia del vínculo conversación–lead.** Después de cerrar mediante `updateManagement`, `unlinked_at` sigue nulo. El historial por periodos queda abierto y puede solaparse con futuras atenciones. Cerrar los vínculos correspondientes en la misma transacción de cierre.
3. **La recuperación de P2002 dentro de la misma transacción no funciona como se pretende.** En PostgreSQL real, tras una inserción Prisma que falla con P2002, la siguiente consulta falla por transacción abortada (`25P02`). La rama que busca al ganador dentro de esa transacción necesita reintento externo, un savepoint o una inserción con tratamiento de conflicto que no aborte la transacción. La prueba confirma la semántica de PostgreSQL; no fuerza una carrera completa del intake.

Los resultados detallados están en `integration-checks.json`: 14 comprobaciones, 12 resultados esperados y 2 fallos de comportamiento, más la demostración de transacción abortada incluida entre las comprobaciones esperadas.

## Correcciones de código (mismo día, re-chequeo)

Tras el informe, se corrigió en código (producción no tocada):

1. `projectLeadAssignee` — proyección solo a chats de la misma persona/categoría (`program_id` de línea).
2. `endLeadConversationLinks` — en todo cierre (gestión, expire, supersede, terminal status).
3. `withLeadCreateSavepoint` — recuperación P2002 sin abortar la transacción externa.

`leads-rehearsal-check.cjs` re-ejecutado sobre la copia: **16/16** comprobaciones OK (incluye las 3 que fallaban). 40 unit tests leads + `tsc` OK.

## Próximos pasos

1. ~~Corregir los tres hallazgos~~ (hecho en código; revalidado en copia).
2. Revisar y aprobar decisiones para los 123 grupos manuales y validar los 65 candidatos. No escoger un ganador únicamente por fecha.
3. Ensayar las resoluciones aprobadas en una copia recuperable y volver a contar duplicados antes de instalar los índices.
4. Mantener los 3.748 históricos en lote separado; no generar alertas históricas masivas.
5. Solo después, preparar el despliegue con flag apagado y solicitar autorización para modificar producción. Este ensayo no autoriza despliegue ni activación.

## Reproducibilidad

Se conservan los contenedores locales detenidos, el dump y los logs. Para continuar el ensayo local, arrancar ambos contenedores y ejecutar los scripts dentro del auxiliar; sus credenciales locales ya están configuradas. No copiar credenciales de producción a comandos.

```sh
docker start mali-leads-rehearsal-20261029 mali-leads-rehearsal-tools-20261029
docker exec mali-leads-rehearsal-tools-20261029 node api/scripts/leads-rehearsal-audit.cjs
docker exec mali-leads-rehearsal-tools-20261029 node api/scripts/leads-rehearsal-check.cjs
```

El segundo script devuelve código de error mientras persistan los fallos reproducidos. Ambos scripts rechazan destinos distintos de la base local de ensayo. Copiar al contenedor el código actualizado antes de volver a comprobar correcciones.

`tested-source-sha256.json` identifica el esquema, la migración y los archivos clave efectivamente ensayados. El repositorio siguió recibiendo cambios durante la sesión; este resultado se refiere a esa captura concreta, no a versiones posteriores.
