const config = require('../config');
const { normalizePhone } = require('../utils/phone');
const {
  getWhatsAppCredentialsForArea,
  getWabaIdOverrideForArea,
} = require('./metaSettingsCache');

function resolveAreaFromPhoneNumberId(phoneNumberId) {
  const id = String(phoneNumberId || '').trim();
  const pam = getWhatsAppCredentialsForArea('pam').phoneNumberId;
  const edu = getWhatsAppCredentialsForArea('educacion').phoneNumberId;
  if (id && pam && id === pam) return 'pam';
  if (id && edu && id === edu) return 'educacion';
  return null;
}

/**
 * Meta a veces envía `messages` sin `metadata.phone_number_id`. En webhooks de tipo
 * whatsapp_business_account, `entry.id` es el WABA ID — lo usamos como respaldo.
 */
function resolveInboundArea(value, wabaEntryId) {
  const metaPid = String(value?.metadata?.phone_number_id ?? '').trim();
  let area = resolveAreaFromPhoneNumberId(metaPid);
  if (area) return { area, source: 'phone_number_id' };

  const waba = String(wabaEntryId ?? '').trim();
  if (waba) {
    const wabaPam = String(getWabaIdOverrideForArea('pam') || '').trim();
    const wabaEdu = String(getWabaIdOverrideForArea('educacion') || '').trim();
    if (wabaPam && waba === wabaPam) return { area: 'pam', source: 'waba_entry_id' };
    if (wabaEdu && waba === wabaEdu) return { area: 'educacion', source: 'waba_entry_id' };
  }

  const pam = getWhatsAppCredentialsForArea('pam');
  const edu = getWhatsAppCredentialsForArea('educacion');
  const hasPam = !!pam.phoneNumberId;
  const hasEdu = !!edu.phoneNumberId;
  if (hasPam && !hasEdu) return { area: 'pam', source: 'single_configured_line' };
  if (hasEdu && !hasPam) return { area: 'educacion', source: 'single_configured_line' };

  return { area: null, source: null };
}

function extractInboundMessagePreview(msg) {
  const type = String(msg?.type || 'unknown').trim();
  if (type === 'text') {
    const body = String(msg?.text?.body ?? '').trim();
    return { messageType: 'text', bodyText: body || '(vacío)' };
  }
  if (type === 'image') return { messageType: 'image', bodyText: '[Imagen]' };
  if (type === 'audio' || type === 'voice') return { messageType: type, bodyText: '[Audio]' };
  if (type === 'video') return { messageType: 'video', bodyText: '[Video]' };
  if (type === 'document') return { messageType: 'document', bodyText: '[Documento]' };
  if (type === 'sticker') return { messageType: 'sticker', bodyText: '[Sticker]' };
  if (type === 'location') return { messageType: 'location', bodyText: '[Ubicación]' };
  if (type === 'contacts') return { messageType: 'contacts', bodyText: '[Contacto]' };
  if (type === 'button') {
    const t = String(msg?.button?.text ?? '').trim();
    return { messageType: 'button', bodyText: t || '[Botón]' };
  }
  if (type === 'interactive') return { messageType: 'interactive', bodyText: '[Interactivo]' };
  return { messageType: type || 'unknown', bodyText: `[${type || 'mensaje'}]` };
}

/**
 * Persiste mensajes entrantes del usuario en chat_messages (direction inbound).
 * Esas filas son el texto que el cliente "respondió" en WhatsApp; no confundir con
 * campaign_logs.response (metadatos de API / estados de entrega de campañas).
 */
async function persistInboundMessagesFromWebhookValue(query, value, context = {}) {
  const messages = Array.isArray(value.messages) ? value.messages : [];
  if (messages.length === 0) {
    return;
  }

  const wabaEntryId = context.wabaEntryId;
  const { area, source } = resolveInboundArea(value, wabaEntryId);
  const metaPid = value?.metadata?.phone_number_id ?? null;

  if (!area) {
    console.log(
      JSON.stringify({
        level: 'warn',
        message: 'Webhook: no se pudo resolver area para mensajes entrantes',
        phoneNumberId: metaPid,
        wabaEntryId: wabaEntryId || null,
        webhookField: context.field || null,
        hint:
          'Define WABA_ID_PAM / WABA_ID_EDUCACION o deja solo una linea PHONE_NUMBER_ID_* configurada.',
      })
    );
    return;
  }

  if (source !== 'phone_number_id') {
    console.log(
      JSON.stringify({
        level: 'info',
        message: 'Webhook inbound: area resuelta sin metadata.phone_number_id',
        area,
        source,
        wabaEntryId: wabaEntryId || null,
      })
    );
  }

  let saved = 0;
  let skippedInvalidPhone = 0;
  let skippedDuplicate = 0;

  for (const msg of messages) {
    const from = normalizePhone(msg.from);
    const waId = String(msg.id || '').trim();
    if (!from || !config.e164NoPlusRegex.test(from)) {
      skippedInvalidPhone += 1;
      continue;
    }

    const contactRow = await query(`SELECT id FROM contacts WHERE area = $1 AND phone = $2 LIMIT 1`, [
      area,
      from,
    ]);
    const contactId = contactRow.rows[0]?.id ?? null;

    const { messageType, bodyText } = extractInboundMessagePreview(msg);

    const convResult = await query(
      `INSERT INTO conversations (area, phone, contact_id, last_user_message_at, last_message_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW(), NOW())
       ON CONFLICT (area, phone) DO UPDATE SET
         contact_id = COALESCE(EXCLUDED.contact_id, conversations.contact_id),
         last_user_message_at = NOW(),
         last_message_at = NOW(),
         updated_at = NOW()
       RETURNING id`,
      [area, from, contactId]
    );
    const conversationId = convResult.rows[0].id;

    try {
      await query(
        `INSERT INTO chat_messages (conversation_id, direction, wa_message_id, body_text, message_type, raw_payload)
         VALUES ($1, 'inbound', $2, $3, $4, $5::jsonb)`,
        [conversationId, waId || null, bodyText.slice(0, 8000), messageType, JSON.stringify(msg)]
      );
      saved += 1;
    } catch (e) {
      if (e.code === '23505') {
        skippedDuplicate += 1;
        continue;
      }
      throw e;
    }
  }

  if (saved > 0) {
    console.log(
      JSON.stringify({
        level: 'info',
        message: 'Webhook inbound guardado en chat_messages',
        area,
        saved,
        source,
      })
    );
  } else if (messages.length > 0) {
    console.log(
      JSON.stringify({
        level: 'warn',
        message: 'Webhook inbound: ningun mensaje insertado',
        area,
        source,
        messageCount: messages.length,
        skippedInvalidPhone,
        skippedDuplicate,
        sampleFrom: messages[0]?.from != null ? String(messages[0].from).slice(0, 32) : null,
      })
    );
  }
}

module.exports = {
  resolveAreaFromPhoneNumberId,
  resolveInboundArea,
  persistInboundMessagesFromWebhookValue,
  extractInboundMessagePreview,
};
