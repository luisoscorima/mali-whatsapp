# Reglas de consolidación de Educación

Educación pasa a ser un solo área (`educacion`), con una WABA y varias líneas. CA y EP dejan de ser áreas y quedan como programas. PAM, Patronato y TI no se tocan.

Estas reglas las aplica `api/scripts/consolidate-education.cjs`. Sin `--apply` el script calcula el mapa y revierte la transacción. Con `--apply` escribe en la base indicada por `DATABASE_URL`.

## Contacto canónico

- La persona se identifica por el teléfono normalizado (solo dígitos).
- WhatsApp user ID, DNI y correo no crean el grupo. Sirven para frenar una fusión dudosa.
- Dentro de un grupo fusionable se conserva un contacto:
  1. el que ya está en `educacion`, si existe;
  2. si no, el de `updated_at` más reciente;
  3. si empatan, el de menor `id`.
- Los demás contactos del grupo se desactivan. Sus conversaciones, campañas, orígenes, leads, atributos y segmentos pasan al canónico. No se borra la fila.
- El canónico queda en `area = educacion`.

## Qué no se fusiona

El grupo queda en `review` y ningún contacto cambia de área si ocurre cualquiera de estos casos:

- hay más de un WhatsApp user ID distinto;
- hay más de un DNI distinto de al menos 8 dígitos;
- hay más de un estado de lead distinto;
- hay más de un asesor distinto en el ciclo más reciente;
- el mismo WhatsApp user ID aparece en teléfonos distintos.

Esos casos quedan en `education_consolidation_map` con `decision = review` para revisión manual. La pantalla es Administración → Conflictos, solo usuario master.

## Conversaciones y líneas

- Una conversación no se fusiona con otra. Se conserva por línea (`whatsapp_line_id`).
- Las conversaciones de `educacion_ca` y `educacion_ep` pasan a `area = educacion` y mantienen su línea.
- Los mensajes no se mueven de conversación.

## Programas

- El alias `educacion_ca` aporta el programa `ca`. El alias `educacion_ep` aporta `ep`.
- El contacto canónico recibe la unión de los programas del grupo.
- Un contacto puede quedar en CA, en EP, en ambos o en ninguno.
- Los alias `educacion_ca` y `educacion_ep` no se borran.

## Catálogos

- Plantillas con el mismo nombre e idioma: se conserva la fila de `educacion` y se retiran las copias de CA y EP. Las campañas guardan el nombre, no el id.
- Estados de lead con el mismo slug: los contactos y ciclos pasan al estado de `educacion`. Las definiciones duplicadas se eliminan solo si ya no tienen referencias.
- Segmentos que existen en una sola área se mueven a `educacion`. Los que comparten slug se unen a la definición de `educacion` sin perder miembros. Ese colapso se corrigió después con `api/scripts/restore-education-segments.cjs --apply`: el mismo slug puede existir en General, en CA y en EP, y las asignaciones vuelven a la categoría de origen. No volver a ejecutar ese script.

## Lo que se reetiqueta y lo que se conserva

- Orígenes, entradas de lead, campañas y formularios de Educación pasan a `area = educacion` porque sus identificadores no chocan entre las tres áreas.
- En formularios Meta y TikTok, el área anterior se guarda en `program_key` antes de reetiquetar.
- Los usuarios cuyo área principal es CA o EP pasan a `educacion`. Las filas de `user_areas` de CA y EP se mantienen para seguir filtrando durante la transición.

## Índices que frenan el cambio de área

Aunque un contacto no esté en revisión, no se mueve a `educacion` si en esa área ya existe el mismo teléfono, correo, DNI o WhatsApp user ID. El índice es único y no distingue activos de inactivos. Esos contactos se quedan en su área histórica.

## Ensayo del 23 de octubre de 2026

Se restauró `mali_whatsapp_20261023_214146.sql.gz` en una base aparte y se aplicó el script. La simulación y la escritura dieron el mismo resultado:

- 5.735 grupos de teléfono.
- 5.279 grupos fusionados y 7.057 contactos desactivados.
- 456 grupos en revisión, todos siguen activos.
- Conversaciones: 23.462 antes y después.
- Mensajes: 127.734 antes y después.
- Ningún WhatsApp user ID quedó repetido entre contactos activos de `educacion`.

La base de ensayo se eliminó después de verificar. Producción no se consolidó: el código que lee `educacion` más programa todavía no está desplegado, y mover las conversaciones antes de eso vaciaría los inbox de CA y EP.

## Criterio para dar por bueno el ensayo

La transacción se revierte si, al terminar:

- cambió la cantidad de conversaciones o de mensajes;
- un grupo `review` quedó fusionado;
- un grupo fusionable sigue teniendo más de un contacto activo con el mismo teléfono;
- dos contactos activos de `educacion` comparten WhatsApp user ID.

## Producción

`--apply` se ejecutó el 26 de octubre de 2026 sobre la base de producción, después del ensayo y con el código que lee `educacion` más categoría ya desplegado. Resultado de esa corrida: 5.735 grupos, 5.268 fusionados, 467 en revisión, conversaciones 23.579 y mensajes 129.039, iguales antes y después. Los alias no se apagaron. No se agregan líneas nuevas desde el script. No volver a ejecutar `--apply`.

## Revisión en Administración → Conflictos

Hay dos listas. Ninguna abre una segunda persona. Cada una tiene dos decisiones.

### Mismo teléfono, varias fichas

Son los grupos con `decision = review`. Se muestran de 40 en 40, por teléfono, no por ficha. La tarjeta dice por qué no se unió sola: WhatsApp distinto, DNI distinto, estado distinto, asesor distinto, o el mismo WhatsApp en otro teléfono.

La ficha marcada como la que se queda trae nombre, apellido, correo y DNI editables. Las otras fichas están solo para comparar.

- **Unir.** Guarda esos datos en la ficha que se queda, le pasa chats, orígenes, leads, atributos, segmentos y programas, y apaga las demás. El grupo pasa a `decision = joined`.
- **Dejar separadas.** No modifica fichas ni personas. El grupo pasa a `decision = separate`.

Arriba se lee cuántos quedan, cuántos se dejaron separados y cuántos se unieron.

### Dato que no coincide con la persona

Son filas de `person_identity_reviews` con `resolved_at` vacío. La persona ya existe. Llegó un teléfono, un DNI, un correo o una identidad de WhatsApp que no coincidía, y no se creó otra persona.

Los campos empiezan con lo guardado. La tarjeta muestra lo que llegó.

- **Guardar en esta persona.** Escribe teléfono, DNI, correo e identidad de WhatsApp en la persona que ya existe, y marca el caso como resuelto.
- **Dejar la persona como está.** Marca el caso como resuelto y no cambia los datos.
