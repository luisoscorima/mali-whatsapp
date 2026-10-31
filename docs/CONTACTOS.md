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
- **Admin → Conflictos** (master): unir fichas del mismo teléfono o resolver dato que no coincide con la persona.

## CRM PAM / Educación

- PAM: sync membresías `POST /api/crm/sync`; audiencia email `GET /api/crm/audience`.
- Educación: captación y ownership en [LEADS.md](./LEADS.md); ONE es vitrina, no segundo CRM.

## Consolidación Educación (ya aplicada)

Una ficha canónica por persona en `educacion`. Grupos en revisión y `person_identity_reviews` se resuelven a mano en Conflictos. Reglas y botones: ver changelog. **No** volver a ejecutar `consolidate-education.cjs --apply`.
