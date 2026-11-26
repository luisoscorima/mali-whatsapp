# Conversaciones — changelog

Vigente: [CONVERSACIONES.md](./CONVERSACIONES.md).

## 2026-11-26 — Composer: drag & drop de adjuntos

- Soltar JPEG/PNG, MP4, audio o PDF en el composer (mismas reglas que el clip); highlight al arrastrar.

## 2026-11-26 — Composer: Toggle shadcn para negrita/cursiva

- Negrita y cursiva usan `Toggle` (`@radix-ui/react-toggle`); `pressed` según la selección.

## 2026-11-25 — Composer: motion ligero (nota de voz)

- UI: swap mic↔enviar, pulse al grabar, fade in/out de modos grabación/preview y aparición del stop (solo opacidad; sin blur/barras).
- Doc: sección Composer en [CONVERSACIONES.md](./CONVERSACIONES.md).

## 2026-11-25 — Mensajes programados en inbox

- Composer: reloj (con contenido) → programar texto/adjunto; default mañana 08:00 Lima.
- Burbuja programada + evento timeline “Mensaje programado para … - Ver”; modal listar/cancelar.
- API `POST/GET/DELETE …/schedule` y `…/scheduled-messages`; delay BullMQ outbound.
- Notas del asesor: íconos editar/eliminar; Variable/Añadir en la misma fila; textarea del composer con radio.

## 2026-11-18 — Indicador pago en inbox

- Header/ficha muestran vínculo `payment_link` cuando el ciclo tiene `EducacionSale` en ONE. Ver [PAYMENT-LOOKUP-WA.md](./PAYMENT-LOOKUP-WA.md).

## 2026-11-03 — Ficha del área + aviso cross-área

- Detalle: segmentos solo de ficha local; nota de otras fichas de la misma persona.
- Sin ficha del área: se crea/vincula al abrir o en inbound; ya no se pintan segmentos de Educación en un chat PAM.

## 2026-10 — Doc inicial

Inbox por línea; ownership de lead separado del hilo; consolidación conservó conversaciones/mensajes sin fusionar hilos.
