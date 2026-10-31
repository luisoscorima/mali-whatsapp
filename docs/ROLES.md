# Roles y permisos

Histórico: [ROLES-CHANGELOG.md](./ROLES-CHANGELOG.md). Relacionado: [AREAS.md](./AREAS.md), [CATEGORIAS.md](./CATEGORIAS.md).

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
| Plantillas en Chats | `templates.send_from_chat` permite listar las aprobadas/activas y enviarlas desde Chats, sin habilitar el módulo/ícono Plantillas (`templates.list`) |

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
