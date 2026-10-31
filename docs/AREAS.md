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

- Identidad y captación nuevas: solo **`educacion`**.
- `educacion_ca` / `educacion_ep` son **aliases históricos** (y, en producto, categorías CA/EP). **No** son áreas de ficha ni de captación nueva.
- Escritura canónica: `educationWriteArea` / store Meta → `educacion`; la categoría sale de la línea (`program_id`) o del form route (`program_key`).

## Aislamiento

- Ficha (`contacts`), inbox y permisos son por área.
- La **persona** (`people`) es global; la ficha es por área canónica.
- Un mismo teléfono puede existir en PAM y en Educación como fichas distintas de la misma persona.

## Administración

- Catálogo y alta de categorías del área: **Admin → Áreas**.
- Credenciales Meta / líneas: [META-WABA.md](./META-WABA.md), [LINEAS.md](./LINEAS.md).
- Usuarios: área primaria + `user_areas`; master ve todas.

## Límite con MALI ONE

mali-whatsapp es fuente de verdad de personas, fichas, líneas y leads. MALI ONE opera por API (`CRM_SERVICE_TOKEN`) sin otra base de personas. El chat no se mueve a ONE.
