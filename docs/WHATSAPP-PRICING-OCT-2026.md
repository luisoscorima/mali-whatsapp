# WhatsApp API — cambios de precio (01 oct 2026)

Checklist y contexto operativo para mali-whatsapp antes de que Meta cobre mensajes de servicio y utility dentro de la ventana 24h.

**Fecha límite:** 01 de octubre 2026 (00:00 zona horaria de la WABA)  
**Método de pago Meta:** antes del **30 de septiembre 2026**

Referencias:

- [Pricing WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [Service / utility / non-template updates](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages)

---

## Resumen (para gerencia)

| Antes | Desde 01 oct 2026 |
| --- | --- |
| Responder al cliente en la ventana 24h (*service*: texto, media, bot) era **gratis** | Se **cobra** por mensaje entregado |
| Plantillas **utility** dentro de la ventana 24h eran **gratis** | También se **cobran** |
| Campañas / plantillas marketing, utility y auth fuera de ventana ya cobraban | Siguen cobrando; en Perú utility/auth/*service* ~**USD 0.02 → 0.03** |
| Marketing Perú | Al parecer se **mantiene** (~USD 0.0703) |

Cupo típico reportado: **~1.000 mensajes *service* gratis por número de negocio y mes**. El cupo **no** cubre plantillas utility. Tras el cupo, tarifa Perú ≈ **USD 0.03** por mensaje *service* entregado.

Ventana **72h gratis (free entry point):** leads que entran por anuncio **Click-to-WhatsApp** o CTA de página Facebook (app móvil), si respondemos a tiempo. Conviene priorizar esa atención.

**Lo más afectado en este proyecto:** Chat (inbox manual) y Flujograma/chatbot. Cada reply sale del cupo de 1.000 o genera costo.

---

## Checklist antes del 01 de octubre

### A. Meta / Billing (obligatorio, no es código)

- [ ] Confirmar **método de pago** en [Billing Hub](https://business.facebook.com/billing_hub) para cada WABA **antes del 30 sep 2026**. Sin pago, Meta puede dejar de entregar mensajes *service*.
- [ ] Revisar qué **números / líneas** tenemos y a qué área corresponden (el cupo de 1.000 es **por número**, no por empresa).
- [ ] Confirmar moneda de facturación (USD / PEN según WABA) y quién ve la factura.

### B. Medición de volumen (para saber el impacto real)

- [ ] Estimar cuántos mensajes *service* salen hoy al mes por número:
  - replies del **inbox** (asesores)
  - mensajes del **flujograma / chatbot**
  - media, botones, etc. (todo no-plantilla cuenta como *service*)
- [ ] Separar, si se puede, volumen de plantillas **utility** enviadas **dentro** de ventana 24h (esas cobran **sin** cupo de 1.000).
- [ ] Identificar picos (campañas + chat el mismo mes) y números más cargados.

### C. Producto / app (mali-whatsapp)

- [ ] **Contador de cupo *service***: mostrar uso de las ~1.000 respuestas gratis/mes **por número** (inbox + flujos).
- [ ] Al superar el cupo, **estimar costo** a ~USD 0.03 (Perú) por mensaje *service* entregado.
- [ ] Actualizar tarifas hardcodeadas en `api/src/campaigns/campaign-pricing.util.ts`:
  - hoy: auth/utility `0.02`, marketing `0.0703`, service `0`
  - objetivo oct: auth/utility/**service** ~`0.03`, marketing revisar si Meta confirma sin cambio
  - marcar el KPI de campaña como **estimado** (no “tarifa oficial” si no viene de Meta)
- [ ] Decidir si el costo del **inbox/flujos** se muestra en dashboard (además del costo de campañas).
- [ ] Revisar copy UI que diga sync / tarifa oficial WABA si aún no hay pull real de facturación Meta.

### D. Operación / uso moderado

- [ ] Acordar criterios de uso del **chatbot/flujo** (menos mensajes redundantes, evitar cascadas largas).
- [ ] Capacitar asesores: cada reply manual cuenta para el cupo / costo.
- [ ] Priorizar atención de leads **CTWA / CTA Facebook** para aprovechar la ventana ~72h gratis.
- [ ] Revisar plantillas **utility** usadas en chat: si ya hay ventana abierta, a veces un texto libre (*service*) vs utility tiene el mismo orden de precio; no asumir “utility en chat = gratis”.
- [ ] Terminar pruebas del chatbot al **100%** con foco en volumen de mensajes por conversación, no solo en “funciona”.

### E. Validación post-cambio (primera semana de octubre)

- [ ] Revisar webhooks `pricing` (`billable`, `category: service|utility|...`) en entregas reales.
- [ ] Contrastar factura / pricing analytics de Meta vs contador interno.
- [ ] Ajustar tarifas o copy si Meta publica matices (cupo exacto, mercados).

---

## Impacto por módulo

| Módulo | Impacto | Notas |
| --- | --- | --- |
| Inbox (respuestas manuales) | Alto | Pasan a *service* cobrable tras cupo |
| Flujos / chatbot | Alto | Cada mensaje del flujo descuenta cupo o cobra |
| Campañas (plantillas) | Medio | Siguen cobrando; utility/auth Perú ~+50% |
| CRM / plantillas producto | Bajo–medio | Según categoría de plantilla |
| KPI costo campaña | Alto (datos) | Tarifas actuales desfasadas; `service = 0` incorrecto |

Archivo de tarifas actuales: `api/src/campaigns/campaign-pricing.util.ts`.

---

## Propuesta mínima de producto (prioridad)

1. Contador **1.000 *service* gratis / mes / número** (inbox + flujograma).
2. Estimación de costo al superar el cupo (~0.03 USD).
3. Actualizar `CATEGORY_PRICING` (incluir `service` ≠ 0).
4. Uso más moderado de chat y flujos hasta tener números reales de octubre.

---

## Fuera de alcance inmediato

- Integrar facturación real de Meta (pricing analytics) end-to-end — deseable después del contador estimado.
- Meta Business Agent (otra categoría / cobro por tokens) — no aplica si no lo usamos.
- Cambios al modelo de envío Graph API — el envío no se rompe; cambia el costo.
