# Segmentos

Audiencias reutilizables por área y categoría. Alimentan filtros de inbox y campañas.

Histórico: [SEGMENTOS-CHANGELOG.md](./SEGMENTOS-CHANGELOG.md). Relacionado: [CATEGORIAS.md](./CATEGORIAS.md), [CONTACTOS.md](./CONTACTOS.md), [CAMPANAS.md](./CAMPANAS.md).

## Modelo

- Definición + asignaciones con el mismo **área**, **slug** y **`program_id`** (null-aware = General).
- El mismo slug puede existir en General, CA y EP como definiciones distintas.
- Independientes de los estados de lead.

Pantallas: `/segments`, `/segments/new`, `/segments/:id`.

## Campañas

`POST /campaigns/recipients-preview` y `POST /campaigns/send` aceptan `category=`:

- `category=general` → `program_id IS NULL`
- `category=ca` / `ep` → programa; varios `category=` = unión
- Sin `category` → todas las del área

Si el mismo slug existe en CA y EP y ambas están seleccionadas, se incluyen ambas. Exclusiones por segmento usan el mismo alcance. IDs explícitos se intersectan con la audiencia (no la saltan).

Deduplicación por `person_id` (ficha elegible de menor ID). Alias `educacion_ca` / `educacion_ep` consultan fichas canónicas de Educación y fijan categoría. PAM/Patronato/TI ignoran filtros de categoría de Educación.

Selección persistida en `campaign_payload.categories`. Worker usa el mismo filtro; reintentos no reconstruyen audiencia por slug.

## Permisos

`segments.assign` / `segments.assign_bulk` (también desde chat). Gestionar definiciones: módulo segmentos.
