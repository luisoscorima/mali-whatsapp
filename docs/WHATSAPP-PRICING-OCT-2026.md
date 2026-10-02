# WhatsApp API — precios vigentes (desde el 1 oct 2026)

El cobro ya rige desde las 00:00 de la zona horaria de la cuenta de WhatsApp. En este proyecto el mercado es **Perú** (prefijo +51). Cada categoría usa la tarifa de **lista** de la fila Perú. Los soles y los dólares salen de la tarjeta de esa moneda; no se convierten entre sí.

Fuentes:

- [Precios de la plataforma](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/?locale=es_LA)
- [Mensajes de servicio y utilidad](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages/?locale=es_LA)

La fila Perú se tomó de las hojas «Tarifas en PEN» y «Tarifas en USD» con vigencia **1 de octubre de 2026**.

## Tarifa de lista, Perú

| Categoría | Hasta el 30 sep 2026 | Desde el 1 oct 2026 |
| --- | --- | --- |
| Marketing | USD 0.0703 / PEN 0.2339 | Igual |
| Utilidad | USD 0.0200 / PEN 0.0665 | USD 0.0300 / PEN 0.0998 |
| Autenticación | USD 0.0200 / PEN 0.0665 | USD 0.0300 / PEN 0.0998 |
| Servicio (respuestas sin plantilla) | Gratis | USD 0.0300 / PEN 0.0998 después de 1.000 al mes |

Utilidad y autenticación en Perú subieron. Marketing no está en la lista de subidas. Autenticación internacional no aplica a Perú.

## Qué cambió para este proyecto

- Cada respuesta de chat o de flujograma es un mensaje de **servicio**. Hay **1.000 gratis por número y mes** (no se acumulan). Desde la 1.001 se estima con la tarifa de servicio de Perú. El cupo es por área, porque cada área usa un número.
- Una plantilla de utilidad se cobra siempre, también dentro de la ventana de 24 horas, y **no** descuenta las 1.000 respuestas. La enviada desde el chat sigue en el costo de la campaña.
- La ventana de 72 horas de un anuncio Click-to-WhatsApp o de un botón de Facebook sigue gratis. El contador del inbox no la separa: el número es referencial.
- Utilidad y autenticación tienen tramos de volumen en la hoja de niveles PEN. El monto de la app usa solo el primer tramo (tarifa de lista).
- Sin método de pago en Meta, las respuestas del chat pueden dejar de entregarse. Hay que comprobarlo en [Billing Hub](https://business.facebook.com/billing_hub). El plazo del 30 sep 2026 ya pasó.

## Dónde se ve en la app

- Campañas: el detalle y el resumen usan la tarifa según la fecha del envío (`primer envío`, si no la programada, si no la de creación), hora de Lima. Antes del 1 oct 2026 se queda la tabla anterior. El texto dice «Estimado de lista (Perú)».
- Inbox: encima del buscador, una línea con las respuestas del mes que Meta marcó como entregadas o leídas y, si pasan de 1.000, el estimado en soles. No incluye plantillas ni mensajes que no llegaron.

El envío por Graph API no cambia. El monto no es la factura de Meta.
