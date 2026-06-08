# Mejoras — observaciones de usuarios

Seguimiento del plan **«Plan revisado — observaciones de usuarios y viabilidad»**.  
**Estado:** entregables 1–4 implementados · **SIGE** fuera de v1.

---

## Lista de mejoras implementadas

1. **Envíos fallidos** — *Necesidad:* ver teléfonos que fallaron y el motivo. · *Implementado:* tabla en detalle de campaña + export CSV.
2. **Respondieron** — *Necesidad:* cuántos respondieron y lista de números. · *Implementado:* KPI en detalle (ventana 7 días) + lista al hacer clic.
3. **Leads desde anuncios Meta (CTWA)** — *Necesidad:* saber si el mensaje viene de Facebook o Instagram y ver datos del anuncio. · *Implementado:* detección automática de `referral` (incl. `context.referral`), globo en el chat, listado en `/anuncios` con leads y nombre editable.
4. **Descargar imágenes en web** — *Necesidad:* guardar vouchers desde el PC. · *Implementado:* botón descargar en el hilo (endpoint autenticado).
5. **Inversión / costo por campaña** — *Necesidad:* monto gastado en el envío masivo. · *Implementado:* sync costo WABA + estimado si Meta no devuelve dato (no incluye spend de Ads).
6. **Mensaje personalizado + filtros** — *Necesidad:* nombre, sede, monto, fecha por contacto. · *Implementado:* definiciones de atributos por área y por segmento (`/attributes`), formularios dinámicos en contactos, CSV, mapeo `{{n}}` en campaña.
7. **Menos errores en masivos** — *Necesidad:* reintentar fallos transitorios. · *Implementado:* reintento auto ~10 min + botón manual, sin duplicar si ya se entregó.
8. **Exclusión en campañas** — *Necesidad:* no enviar a ciertos contactos o segmentos. · *Implementado:* excluir segmentos en nueva campaña; exclusión puntual desmarcando en paso Destinatarios.
9. **Crear plantillas en la app** — *Necesidad:* no depender solo de Business Manager. · *Implementado:* `/templates` y `/templates/new`, envío a revisión Meta + webhook de estado.

---

## Pendiente (no v1)

- **SIGE** — matrícula / conversión por campaña (backlog v2).
- **Inversión de pauta** en Ads Manager.
- **Llamadas** WhatsApp.
- Segmentos automáticos por reglas de atributos.
- Filtro por rango de fechas en `fecha_pago` (v1: solo filtro «contiene»).
- respuestas predefinidas.
- Fecha de creación de contacto
- Informes, kpis (leads, atendidas por asesor, ventas, conversion, mensajes por dia y hora)
-  Mejorar permisos, roles, de usuarios, agrupacion por equipos.
- Mejorar integracion o conexion con whatsapp cloud api.
- Mensajes de reintento automatico por inactividad
- Cambiar nombre de segmentos a Etiquetas.
- implementar en ese orden (export → whitelist import → preview atributos → UI).
- Antes de enviar campaña, mostrar una vista previa y un resumen de lo que se quiere enviar (seguna validación) ¿está seguro de…?

---

## Decisiones de producto

- **Costo campaña** = solo envío masivo en la app (WABA), no spend de pauta Meta.
- **CTWA** = registro automático por `source_id`; plataforma desde `source_url`; sin reglas manuales.
- **Respondió** = ventana de **7 días** post-envío.
- **Reintento** = automático ~10 min + manual; errores permanentes no se reintentan.

---

## Dónde probarlo en el panel


| Módulo                                      | Ruta                             |
| ------------------------------------------- | -------------------------------- |
| Fallidos / respondieron / costo / reintento | Detalle campaña `/campaigns/:id` |
| Nueva campaña (exclusiones, vars)           | `/campaigns/new`                 |
| Plantillas                                  | `/templates`, `/templates/new`   |
| Anuncios Meta (CTWA)                        | `/anuncios`                      |
| Atributos (definiciones)                    | `/attributes`                    |
| Contactos y filtros                         | `/contacts`                      |


