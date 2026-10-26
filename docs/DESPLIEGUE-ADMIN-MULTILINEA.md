# Despliegue: administración multilínea sin reinicios por cada alta

Estado de referencia, confirmado por el usuario el 24 de octubre de 2026:
- Producción ejecuta `e18791b`. CA y EP ya se probaron inbound/outbound.
- `d4b263a` está en Git pero no en producción.
- Hay seis líneas operativas en total y se preparan otras seis nuevas.
- Esta entrega agrega cambios locales sobre `d4b263a`, sin commit ni PR.

## Alcance de este corte

Un área de negocio admite varias líneas. Cada línea pertenece a una WABA y puede tener un programa (CA/EP) y un token propio o heredar el token de la WABA. Las líneas nuevas usan el área canónica; los alias históricos existentes se conservan. No se ejecuta `consolidate-education.cjs --apply` en este corte.

`/admin/whatsapp` (solo master) permite:
- Ver las líneas agrupadas por área y filtrar el catálogo.
- Crear WABA y líneas en borrador, asignando área, WABA y programa.
- Guardar tokens cifrados y validarlos antes de reemplazar las credenciales.
- Validar líneas contra Meta, activarlas/desactivarlas individualmente y elegir la predeterminada del área.
- Cambiar el nombre visible sin alterar la identidad de las conversaciones.

La misma API actualiza su caché al guardar. Otras réplicas actualizan cada 15 segundos. Si la base falla se conserva el último catálogo cargado y se registra una advertencia; la propagación se reanuda al recuperar conexión. Las operaciones en curso pueden terminar antes de una desactivación. Un PID desactivado no vuelve a habilitarse por el fallback del `.env`. Los PIDs desconocidos en un webhook no se adjudican a otra línea por compartir WABA.

Los cambios de línea predeterminada son transaccionales. Las conversaciones existentes siguen respondiendo con su propio PID. CA y EP conservan sus remitentes históricos durante la transición.

## Preparación del despliegue

1. Respaldar PostgreSQL y conservar las imágenes actuales de API/web para rollback. Conservar las variables y tokens heredados.
2. Mantener `WHATSAPP_LINE_CATALOG_ENABLED=true` (ya habilitado según el informe anterior).
3. Configurar **una sola vez** `WHATSAPP_CREDENTIALS_MASTER_KEY`: 32 bytes aleatorios codificados en base64 o 64 caracteres hexadecimales. Guardarla en el gestor de secretos y respaldo seguro, fuera de Git. Todas las réplicas deben usar la misma clave. No cambiarla después de guardar tokens sin una migración de cifrado.
4. Entregar el código completo, incluyendo `d4b263a` y los cambios locales de esta entrega. La migración pendiente `20261023220000_education_route_program_key` añade dos columnas opcionales y la ejecuta el entrypoint.
5. Construir las imágenes y recrear únicamente API y web. No es necesario bajar PostgreSQL/Redis ni ejecutar `docker compose down`:

```bash
docker compose build api web
docker compose up -d --no-deps api web
docker compose ps
docker compose logs --tail=120 api
curl -fsS https://whatsapp.mali.pe/health
```

Este primer despliegue sí recrea API/web y puede causar una interrupción breve. Las altas y cambios posteriores de líneas se hacen desde el panel, sin editar el `.env` ni recrear contenedores por cada número.

## Pruebas de aceptación

1. Entrar como master a `/admin/whatsapp`. Confirmar catálogo habilitado y bóveda configurada. Comparar las seis líneas operativas con el inventario real. Los seis números de la WABA Educación enumerados en el documento del 23 de octubre no son el inventario global.
2. Probar nuevamente entrada y respuesta en las seis líneas actuales, incluidas CA/EP, después del despliegue. Revisar que aparezcan en el área correcta y respondan desde el número receptor.
3. Para una línea nueva: elegir una WABA existente; si no tiene token compartido, configurar uno en la WABA o dar un token propio a la línea. Crear el borrador con área canónica y programa opcional. Confirmar que aún no está activa.
4. Validar el PID contra Meta. Una validación fallida debe dejar la línea sin posibilidad de activación y no cambiar el token de otras líneas. Corregir las credenciales si hace falta.
5. Activar la línea. Probar inbound y respuesta sin reiniciar. Si hay varias réplicas, esperar hasta 15 segundos con la base disponible.
6. Escribir desde el mismo teléfono a dos líneas del área: deben mantenerse conversaciones distintas, cada una respondiendo por su línea. En CA/EP, comprobar también el filtro por programa.
7. En una línea de prueba, desactivar y confirmar que no se procesa como otra línea ni permite responder usando el token heredado. Volver a validar/activar y probar. Evitar desactivar la predeterminada operativa sin elegir antes otra.
8. Si se cambia la predeterminada, comprobar que los nuevos envíos por área la usan y las conversaciones anteriores mantienen la suya. Los alias históricos CA/EP mantienen su línea.
9. Repetir el alta individual para las demás líneas nuevas. No es necesario activarlas todas juntas.

Validar en Meta comprueba acceso y pertenencia a la WABA. No registra automáticamente un número en Cloud API, no configura la suscripción del webhook y no sustituye una prueba real de entrega. La interfaz muestra el estado de suscripción informado por Meta; confirmar también la app correcta en Meta antes de activar números nuevos.

## Rollback y límites

- Antes de añadir líneas o cambiar tokens/predeterminadas, el rollback de aplicación consiste en restaurar las imágenes anteriores y recrear solo API/web. Las dos columnas nuevas son aditivas y no requieren borrado.
- Si ya se activaron líneas nuevas, desactivarlas primero y restaurar la predeterminada anterior. El código viejo no tiene esta administración; no rotar ni eliminar las credenciales heredadas durante el piloto. Conservar la clave de cifrado aunque se vuelva a la imagen anterior.
- No usar la bandera del catálogo como mecanismo de desactivación: con `false` vuelve el comportamiento heredado del `.env`.
- La fusión de contactos, revisión de los 456 grupos del ensayo y retiro de alias son otra etapa. Este corte no modifica esos datos ni agrega áreas nuevas al catálogo de permisos de la aplicación.
- El selector de línea por campaña no forma parte de esta entrega: se conserva la elección por área/predeterminada y la identidad guardada de cada conversación/campaña.

## Validación local

Se regeneró Prisma Client para el esquema actual. Ejecutar desde la raíz:

```bash
npm run build --workspace api
npm run build --workspace web
npm test --workspace api -- --runInBand whatsapp-admin.service.spec.ts meta-settings.service.spec.ts meta-settings.store.spec.ts credential-vault.util.spec.ts education-scope.spec.ts education-crm.spec.ts webhook-bsuid.spec.ts webhook.service-bsuid.spec.ts
```

Las pruebas de Meta usan dobles locales; no se llamaron números reales ni se cambió producción durante este trabajo. Las pruebas de aceptación anteriores son necesarias tras desplegar.

Resultado de esta revisión: compilaciones de API y web correctas; 8 suites y 41 pruebas aprobadas; `git diff --check` sin errores. La compilación web local avisó que Node 20.17 es anterior al mínimo de Vite (20.19), aunque terminó correctamente; construir la imagen con una versión compatible de Node. No se hizo una prueba visual de navegador ni una prueba real con Meta/producción.
