# Roles y permisos (v1)

Ownership: auth / admin usuarios. Área activa = una a la vez (sin inbox multiárea).

## Principios

| Concepto | Significado |
|----------|-------------|
| **Rol** (`users.role_slug`) | Plantilla de capacidades |
| **Permisos** | Códigos chequeados en API/UI; mapa en código `ROLE_PERMISSIONS` |
| **Área** | `users.area` + `user_areas`; orthogonal al rol |
| **Master** | Eleva todos los permisos (como hoy) |

Fuente de verdad del mapa rol→permisos: `api/src/auth/roles/role-permissions.ts`.

## Grises confirmados

| Tema | Decisión |
|------|----------|
| Gestor e inbox | Sin `conversations.manage` |
| Asesor export chat | Sin `conversations.export` |
| Segmentos/attrs chat vs contactos | Mismos `segments.assign` / `attributes.assign` (+ `_bulk`). Asesor con `contacts.create` / `contacts.update` (desde chat); sin `contacts.manage` |
| Coordinador TMK / PAM / Patronato | Mismo rol `coordinador`; cambian las áreas |
| Leads | `leads.list` para todos **excepto** `asesor_comercial` |

## Catálogo de permisos

Ver `PermissionCode` en `api/src/auth/roles/permission-codes.ts`.

## Roles

| slug | Label |
|------|--------|
| `asesor_comercial` | Asesor comercial |
| `analista` | Analista |
| `gestor` | Gestor |
| `supervisor` | Supervisor |
| `coordinador` | Coordinador |
| `master` | Master (TI) — suele ir con `is_master` |

## Usuarios operativos (seed de migración)

| Email | Rol | Áreas |
|-------|-----|--------|
| achumpitasi@mali.pe | supervisor | educacion, educacion_ep |
| asesordeadmision3@mali.pe | asesor_comercial | educacion, educacion_ca |
| darias@mali.pe | asesor_comercial | educacion, educacion_ep |
| ezurita@mali.pe | asesor_comercial | educacion, educacion_ca |
| gzabalbeascoa@mali.pe | asesor_comercial | educacion, educacion_ep |
| joropeza@mali.pe | coordinador | educacion, educacion_ca, educacion_ep |
| kbaumann@mali.pe | asesor_comercial | educacion, educacion_ca, educacion_ep |
| khuerta@mali.pe | asesor_comercial | educacion, educacion_ca |
| kvillegas@mali.pe | asesor_comercial | educacion, educacion_ca |
| lramirez@mali.pe | supervisor | educacion, educacion_ca, educacion_ep |
| ngonzales@mali.pe | gestor | educacion, educacion_ca, educacion_ep |
| ocaceres@mali.pe | analista | educacion, educacion_ca, educacion_ep |
| maguinaga@mali.pe | coordinador | pam |
| mperez@mali.pe | coordinador | patronato |
| lgutierrez@mali.pe | coordinador | patronato |
| czegarra@mali.pe | coordinador | patronato |
| evelazco@mali.pe | coordinador | patronato |

Primaria = primera área de la lista (o la ya existente si sigue permitida).

## Fuera de alcance v1

- Inbox / producto multiárea combinado
- Pestañas con áreas distintas
- Overrides de permisos por usuario (más allá del rol)
- Borrar columnas `can_*` (se derivan / sincronizan desde el rol)
- Editor de roles (los cambios van por código / deploy)

## Consulta en UI (solo lectura)

Master → **Admin → Roles** (`/admin/roles`): catálogo desde `GET /api/admin/roles` (`buildAdminRolesCatalog`).

## Flags legacy (`can_*`)

Deprecados como fuente de verdad cuando hay `role_slug`. Se rellenan al guardar rol y se exponen en `AuthUser` por compatibilidad. Runtime nuevo: `hasPermission(user, code)`.
