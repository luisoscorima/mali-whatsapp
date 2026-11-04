# Áreas

Tenant aislado del producto: inbox, permisos y ficha de contacto.

Histórico: [AREAS-CHANGELOG.md](./AREAS-CHANGELOG.md). Relacionado: [CATEGORIAS.md](./CATEGORIAS.md), [LINEAS.md](./LINEAS.md), [CONTACTOS.md](./CONTACTOS.md), [ROLES.md](./ROLES.md).

## Qué es

| Pieza | Tabla | Rol |
|-------|--------|-----|
| **Área** | `business_areas` | Tenant: TI, PAM, Patronato, Educación |
| Alias histórico | `business_area_aliases` | Solo lectura/compat; no crea tenant nuevo |

Hay **cuatro** áreas canónicas. No se crea una quinta desde la pantalla. PAM, Patronato y TI **no** se fusionan con Educación.

## Educación y aliases

- Identidad, ficha y captación: solo **`educacion`** (filas en BD con ese `area`).
- `educacion_ca` / `educacion_ep` como **input** se traducen a categoría CA/EP (`educationProgramOf`); en catálogo viven en `business_area_aliases` con `active=false`.
- **No** hay fichas residuales en ca/ep tras `education-alias-contacts`. Lectura (`educationReadScope` / `areaFamily`) = `['educacion']`.
- Escritura: `educationWriteArea` → siempre `educacion`; categoría desde línea (`program_id`) o form route (`program_key`).

## Aislamiento

- Ficha (`contacts`), inbox y permisos son por área.
- La **persona** (`people`) es global; la ficha es por área canónica.
- Un mismo teléfono puede existir en PAM y en Educación como fichas distintas de la misma persona.

## Administración

- Catálogo y alta de categorías del área: **Administración → Áreas**.
- Credenciales Meta / líneas: [META-WABA.md](./META-WABA.md), [LINEAS.md](./LINEAS.md).
- Usuarios: área primaria + `user_areas`; master ve todas.

## Límite con MALI ONE

mali-whatsapp es fuente de verdad de personas, fichas, líneas y leads. MALI ONE opera por API (`CRM_SERVICE_TOKEN`) sin otra base de personas. El chat no se mueve a ONE.

## Qué nota el usuario

Para el día a día (asesores) el área sigue siendo **Educación** con categorías general/CA/EP. Lo que desapareció es el legado de tres tenants Educación y las fichas duplicadas que provocaban errores al importar o al recibir WhatsApp. Detalle de impacto: [CONTACTOS.md](./CONTACTOS.md) § “Impacto para el usuario”.
