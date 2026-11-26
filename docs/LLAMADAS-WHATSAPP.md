# Llamadas de WhatsApp en el inbox

**Estado pendiente de implementación.**

El objetivo es que los clientes puedan llamar desde WhatsApp y que los asesores atiendan desde el navegador en el inbox de Mali. El alcance es voz dentro de WhatsApp. Esto permitiría prescindir de Anura cuando toda la atención de voz se pueda trasladar a ese canal.

## Integración propuesta

Usar directamente la WhatsApp Business Calling API. El backend de Mali reutilizaría su integración con Graph API y su webhook de Meta para la señalización de llamadas. Socket.IO avisaría al inbox y sincronizaría los estados entre asesores. El navegador usaría WebRTC para el audio. Esta ruta permite usar la línea actual si Meta la habilita y funciona sin una troncal SIP.

Chatwoot ofrece llamadas de WhatsApp en planes de pago. La propuesta para Mali es implementar la integración en su propio inbox y evitar depender de una licencia de Chatwoot.

## Alcance por etapas

1. Verificar en Meta el límite de mensajería, la elegibilidad y la configuración de Calling de una línea comercial. Usar un número de prueba para validar la integración si la línea comercial aún no está habilitada.
2. Atender una llamada entrante desde el inbox. Recibir el webhook `calls`, asociarlo con la línea y la conversación, avisar al asesor y permitirle contestar, rechazar, silenciar y colgar. Validar audio en ambos sentidos y que dos asesores no puedan contestar la misma llamada.
3. Añadir llamadas salientes desde la conversación según el modo de permisos de Meta para cada línea. Incorporar al historial el resultado de la llamada, su duración y el asesor que la atendió.

Antes de dar de baja Anura, validar esta operación con una línea comercial y confirmar que el equipo puede trasladar a WhatsApp los flujos que dependían de llamadas a fijos y celulares. Los cargos aplicables de Meta y los costos de infraestructura se deben evaluar por separado.

[WhatsApp Business Calling API](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling) · [Llamadas salientes](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/business-initiated-calls) · [Llamadas en Chatwoot](https://www.chatwoot.com/hc/user-guide/articles/1779871708-connecting-whats_app-voice-channel)
