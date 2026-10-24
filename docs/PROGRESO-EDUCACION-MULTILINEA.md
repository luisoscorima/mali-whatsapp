# Progreso: Educación, un área y varias líneas

Actualizado el 23 de octubre de 2026. Rama `migrate/v2`, al día con `origin/migrate/v2` en el commit `e18791b`. Los cambios de código de esta sesión están sin commit y sin desplegar.

## Objetivo

Educación es un solo área (`educacion`), con una WABA y varias líneas. CA y EP dejan de ser áreas y pasan a ser programas. Una persona puede estar en CA, en EP, en ambos o en ninguno. Cada línea conserva su conversación. PAM, Patronato y TI no entran.

Las seis líneas nuevas no se activan hasta que el código que lee `educacion` más programa esté desplegado y la consolidación de datos se haya aplicado en producción.

## Ya en producción

Commit desplegado: `e18791b`. `WHATSAPP_LINE_CATALOG_ENABLED=true`.

- Migraciones aplicadas: `20261023190000_whatsapp_multiline_foundation` y `20261023210000_business_programs_conversation_line_identity`.
- Catálogo: 4 áreas, 4 WABA, las tres líneas operativas de Educación en la misma WABA.
- Línea predeterminada: Educación, +51 934 595 514.
- CA +51 902 043 388, programa `ca`. EP +51 922 172 157, programa `ep`.
- Conversaciones, campañas y plantillas de las tres áreas ya apuntan a su línea o WABA.
- Los tokens siguen en variables de entorno. Ninguno está cifrado en la base.
- Respaldo verificado: `/home/ubuntu/mali-whatsapp/backups/postgres/mali_whatsapp_20261023_214146.sql.gz` (35 MB).

Los alias `educacion_ca` y `educacion_ep` siguen activos. El producto en ejecución todavía filtra por el área histórica.

## Ensayo de consolidación

Reglas: `docs/REGLAS-CONSOLIDACION-EDUCACION.md`.
Script: `api/scripts/consolidate-education.cjs`.

Se restauró el respaldo en la base `mali_edu_rehearsal`, se aplicó el script y luego se eliminó esa base. Simulación y escritura dieron el mismo resultado:

| Resultado | Valor |
|---|---|
| Grupos de teléfono | 5.735 |
| Grupos fusionados | 5.279 |
| Contactos que se desactivarían | 7.057 |
| Grupos en revisión (no se fusionan) | 456 |
| Conversaciones | 23.462 antes y después |
| Mensajes | 127.734 antes y después |
| WhatsApp user ID repetido en `educacion` activo | 0 |

Un contacto no se fusiona si el grupo tiene estados distintos, asesores distintos, más de un WhatsApp user ID o más de un DNI. Tampoco se mueve de área si choca con el índice único de teléfono, correo, DNI o WhatsApp user ID.

Producción no se consolidó. Hacerlo antes de desplegar este código vaciaría los inbox de CA y EP.

## Líneas descubiertas en la WABA de Educación

Meta devolvió seis números. Tres ya operan. Los otros tres se registraron inactivos el 23 de octubre. El catálogo en ejecución solo carga líneas activas, así que el webhook no las usa.

| Número | Nombre | Estado |
|---|---|---|
| +51 934 595 514 | MALI Educación | Activa, predeterminada |
| +51 902 043 388 | MALI Educación CA | Activa |
| +51 922 172 157 | MALI Educación EP | Activa |
| +51 924 339 640 | MALI Educación 1 | Inactiva, registrada |
| +51 902 125 355 | MALI Educación 2 | Inactiva, registrada |
| +51 912 096 501 | MALI Educación 3 | Inactiva, registrada |

No hay otros tres números en esa WABA. No se activó ninguna línea nueva.

## Código local, sin commit

- Lectura unificada de Educación: `api/src/config/education-scope.ts`. El inbox, el CRM y los leads aceptan `educacion`, `educacion_ca` y `educacion_ep`. CA y EP filtran por programa.
- El inbox muestra la línea de cada conversación.
- CRM acepta `{ "area": "educacion", "programa": "ep" }` y también el alias viejo. El alias guarda el programa en `contact_programs`.
- Administración de líneas, todavía no desplegada: `api/src/whatsapp-admin/` y la pantalla `/admin/whatsapp`. Lista el catálogo y valida una línea contra Meta. No se usó para dar de alta números.
- Cifrado de tokens: `api/src/meta-settings/credential-vault.util.ts`. La bóveda no está configurada en producción.
- Columna nueva, sin aplicar en producción: `program_key` en rutas de formularios Meta y TikTok (`20261023220000_education_route_program_key`).

## Qué sigue

1. Revisar y commitear este código.
2. Desplegar API y web. La migración `20261023220000` corre con el deploy.
3. Probar inbox, un lead CA y un lead EP con el código nuevo.
4. Respaldo nuevo y `node scripts/consolidate-education.cjs --apply` en producción.
5. Activar de a una Educación 1, 2 y 3 desde `/admin/whatsapp`, con prueba de entrada y respuesta en cada una.

## Qué no se hizo

- No hay commit ni PR.
- No se ejecutó la consolidación sobre la base de producción.
- No se activaron Educación 1, 2 ni 3.
- No se rotaron tokens de las líneas que ya operan.
- No se reiniciaron contenedores para este trabajo.
