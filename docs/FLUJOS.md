# Flujos

Respuestas automatizadas (flujogramas) por área y categoría.

Histórico: [FLUJOS-CHANGELOG.md](./FLUJOS-CHANGELOG.md). Relacionado: [CATEGORIAS.md](./CATEGORIAS.md), [CONVERSACIONES.md](./CONVERSACIONES.md), [IA-AJUSTES.md](./IA-AJUSTES.md).

## Modelo

- Definición por área; categoría vía `program_id` (misma semántica null = General que segmentos).
- Nodos de mensaje, botones / esperas; se ejecutan en el hilo de la línea que recibió el inbound.
- Las respuestas del flujo cuentan como mensajes de **servicio** para pricing ([META-WABA.md](./META-WABA.md)).

## Operación

Editor en el panel (módulo flujos). El alcance de categoría se filtra como el resto de catálogos. Un cambio de categoría de la línea no debe reclasificar silenciosamente el historial de ejecuciones.
