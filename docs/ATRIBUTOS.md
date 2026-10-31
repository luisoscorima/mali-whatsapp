# Atributos

Definiciones de campos de perfil (y de lead) para formularios, importación y variables de campaña.

Histórico: [ATRIBUTOS-CHANGELOG.md](./ATRIBUTOS-CHANGELOG.md). Relacionado: [CONTACTOS.md](./CONTACTOS.md), [CATEGORIAS.md](./CATEGORIAS.md), [CAMPANAS.md](./CAMPANAS.md), [LEADS.md](./LEADS.md).

## Qué es

Definiciones por área (y opcionalmente por categoría vía `program_id`). Valores en `contact_attributes`.

| Tipo (producto) | Alcance típico | Uso |
|-----------------|----------------|-----|
| **Contacto** | Persona / área / categoría | Perfil estable (profesión, sede, …) |
| **Lead** | Ciclo de atención | Curso de esta consulta, objeción, … (Educación) |

Pantallas: `/attributes`, `/attributes/new`, `/attributes/:id`.

## Uso

- Formularios de alta/edición de contacto.
- Importación CSV/Excel (columnas mapeadas a definiciones).
- Variables `{{n}}` en plantillas de campaña (valor por contacto).
- Permisos: `attributes.assign` / `attributes.assign_bulk` (también desde chat); administrar definiciones requiere permisos de módulo.

## Categoría

La definición y el valor deben coincidir en área y `program_id` (null = General). Cambiar el destino de una definición ya usada requiere migración explícita.
