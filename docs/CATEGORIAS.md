# Categorías

Producto o servicio **dentro** de un área. En la API/UI se llaman `categoria` / `category`. **No son áreas.**

Histórico: [CATEGORIAS-CHANGELOG.md](./CATEGORIAS-CHANGELOG.md). Relacionado: [AREAS.md](./AREAS.md), [LINEAS.md](./LINEAS.md), [SEGMENTOS.md](./SEGMENTOS.md), [LEADS.md](./LEADS.md).

## Modelo

| Concepto | Representación |
|----------|----------------|
| **General** | `program_id` / `business_programs` **nulo** (no es una fila) |
| **CA**, **EP**, … | Filas en `business_programs` |
| Identificador | Hasta 10 letras, empieza por letra; no puede ser `general` |

Una categoría nueva se crea en **Administración → Áreas**, sin cambiar código. Se da de baja solo si no tiene líneas activas. Otras áreas (PAM, Patronato, TI) pueden no tener categorías.

La distribución de sedes de Educación entre **Norte y Callao**,
**Centro y Este** y **Sur** está en el [inventario operativo](INVENTARIO-WHATSAPP.md#distribución-por-categorías).
La categoría de cada línea se asigna desde **Administración → Líneas**.

## Educación

| Categoría | Clave | Notas |
|-----------|-------|-------|
| General | (null) | Líneas y leads sin programa |
| CA | `ca` | Cursos de Arte |
| EP | `ep` | Arte y cultura / FORM EP |

`educacion_ca` y `educacion_ep` no son áreas actuales. Solo se conservan como compatibilidad de lectura para datos históricos; toda alta o actualización nueva guarda el área `educacion` y la categoría en `program_id`.

## Dónde impacta

- **Líneas:** `whatsapp_lines.program_id` fija la categoría del número.
- **Segmentos / atributos / flujos:** definición y asignación con el mismo `program_id` (null-aware para General).
- **Leads:** ciclo y entrada hacia una categoría; Instant Forms vía `program_key` en form routes.
- **Campañas:** query `category=` filtra audiencia ([CAMPANAS.md](./CAMPANAS.md)).
- **Permisos:** una categoría nueva **no** entra sola en usuarios existentes; hay que marcarla. Master ve todas.

## Reglas

- Mover una línea de categoría cambia el programa visible; el teléfono/WABA siguen; los chats de ese número se ven en la categoría nueva.
- No reclasificar silenciosamente historial de leads/conversaciones solo porque cambió la categoría actual de la línea.
