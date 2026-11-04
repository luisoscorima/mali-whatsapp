# Contactos

Identidad de persona y ficha por área. Fuente de verdad en mali-whatsapp; MALI ONE consume por [CRM-API.md](./CRM-API.md).

Histórico: [CONTACTOS-CHANGELOG.md](./CONTACTOS-CHANGELOG.md). Relacionado: [AREAS.md](./AREAS.md), [ATRIBUTOS.md](./ATRIBUTOS.md), [SEGMENTOS.md](./SEGMENTOS.md), [LEADS.md](./LEADS.md).

## Entidades

| Nombre | Tabla | Qué es |
|--------|--------|--------|
| **Persona** | `people` | Una sola en el sistema. Datos perennes: nombre, apellido, teléfono, email, DNI, nacimiento, identidad WA (BSUID) |
| **Ficha** | `contacts` | Una ficha **activa** por persona y área canónica. Opt-in, relación con el área |
| Datos de área | `contact_attributes` (`program_id` null) | Perfil que cambia por área |
| Datos de categoría | `contact_attributes.program_id` | Perfil por categoría (curso, modalidad, …) |

La persona ya es la entidad unificada. **No** se unifican fichas entre áreas: segmentos, atributos, opt-in y leads cuelgan de la ficha del área. Si la misma persona escribe en otra línea (p. ej. PAM teniendo ficha en Educación), se crea/vincula la ficha de ese área; el inbox puede avisar “También tiene ficha en …” sin pintar segmentos ajenos como locales ([CONVERSACIONES.md](./CONVERSACIONES.md)).

## Match de identidad

Orden global: **identidad WhatsApp (BSUID) → teléfono → DNI → email**.

- Una persona → se reutiliza y se completan huecos.
- Ninguna → se crean persona + ficha del área.
- Claves a personas distintas (o DNI/BSUID conflictivos) → `person_identity_reviews`; no se abre otra persona.

Al menos uno de: teléfono, DNI, email o identidad WA.

Excepción Instant Form Meta/TikTok: pueden reemplazar nombre (y apellido si viene) para no dejar el alias WA de un CTWA previo. En chat, el nombre de perfil es `wa_profile_name` (vacío si no hay).

## Pantallas y operación

- `/contacts` — listado, filtros (número, nombre, email, atributos), alta, edición.
- `/contacts/import` — CSV/Excel; ejemplo `/contacts/sample.xlsx`.
- Alta manual: prefijo con bandera (default 🇵🇪 +51), celular numérico.
- **Administración → Conflictos** (master): unir fichas del mismo teléfono o resolver dato que no coincide con la persona.

## CRM PAM / Educación

- PAM: sync membresías `POST /api/crm/sync`; audiencia email `GET /api/crm/audience`.
- Educación: captación y ownership en [LEADS.md](./LEADS.md); ONE es vitrina, no segundo CRM.

## Regla dura: una ficha por persona y área

En un área canónica (`educacion`, …) no debe haber **dos filas `contacts` con el mismo `person_id`**.

Motivo: los triggers `sync_contact_person` / `sync_person_contacts` proyectan teléfono (y resto de identidad) desde `people` a **todas** las fichas de esa persona. Si un hermano tiene `phone NULL` en la misma área, al actualizar el canónico Postgres intenta copiarle el teléfono y choca con el unique parcial `contacts_area_phone_uq` → Prisma **P2002** (import, webhook, edición).

### Clones `phone NULL` (incidente 2026-11-03)

**Origen:** la consolidación Educación (`consolidate-education.cjs --apply` y el “Unir” de Conflictos de entonces) **reapuntaba** donantes al `person_id` del canónico y les ponía `phone/email/dni/wuid` en NULL **sin borrar** la fila. Quedaron miles de clones en `educacion` (mismo `person_id`, un teléfono + N `NULL`).

**Qué se hizo:** limpieza con `GET/POST /api/admin/conflicts/null-phone-clones` (master): FKs al canónico + **DELETE** del clone. Import: P2002 por fila ya no tumba el request en 500. “Unir” en Conflictos ahora también **borra** el donante.

**¿Vuelven solos?** No con el flujo normal (alta, import, leads, chat). Sí si alguien vuelve a dejar donantes vivos con el mismo `person_id` (p. ej. re-ejecutar `consolidate-education.cjs --apply`, o un merge que solo anule el teléfono). **No** volver a `--apply` (script bloqueado salvo `ALLOW_LEGACY_EDU_SCRIPT=1`). Dry-run: `GET /api/admin/conflicts/null-phone-clones?area=educacion` → `groups_mergeable` = `0`.

### Residuales `educacion_ca` / `educacion_ep` (cierre 2026-11-03)

Tras el cutover 3 áreas → 1, quedaron fichas en slugs legacy. Absorción: `GET/POST /api/admin/conflicts/education-alias-contacts` (merge por phone/BSUID o alta en `educacion` + DELETE). Criterio: `COUNT(*) FROM contacts WHERE area IN ('educacion_ca','educacion_ep')` = **0**. La lectura DB de Educación es solo `educacion`; ca/ep como input solo fijan categoría.

## Consolidación Educación (ya aplicada)

Una ficha canónica por persona en `educacion`. **No** volver a ejecutar `consolidate-education.cjs --apply` ni `relabel-education-aliases.cjs` (usar education-alias-contacts).

## Impacto para el usuario (post cutover + limpiezas 2026-11)

| Quién | Qué espera |
|-------|------------|
| Asesor / operador | Inbox, chats, campañas, contactos e import **igual**. CA/EP siguen siendo **categorías**, no áreas aparte. Import/webhook ya no deberían fallar por clones de teléfono. |
| Credenciales Meta / forms | Un Page token en **`educacion`**. Forms enrutan a categoría (`program_key` ca/ep/general), no a tres “áreas” Meta. |
| Master (Administración) | Herramientas de limpieza en Conflictos (`null-phone-clones`, `education-alias-contacts`). El “Unir” **borra** el donante (antes lo dejaba vacío y rompía sync). |
| MALI ONE / CRM API | `area=educacion`; alias ca/ep en query = filtro de **categoría**, no segunda base de fichas. |

No se quitan pantallas de categoría ni se unifica PAM/Patronato.
