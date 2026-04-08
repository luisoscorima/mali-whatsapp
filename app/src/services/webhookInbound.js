const config = require('../config');
const { normalizePhone } = require('../utils/phone');

function resolveAreaFromPhoneNumberId(phoneNumberId) {
  const id = String(phoneNumberId || '').trim();
  const pam = String(process.env.PHONE_NUMBER_ID_PAM || process.env.PHONE_NUMBER_ID || '').trim();
  const edu = String(process.env.PHONE_NUMBER_ID_EDUCACION || '').trim();
  if (id && pam && id === pam) return 'pam';
  if (id && edu && id === edu) return 'educacion';
  return null;
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

async function persistInboundMessagesFromWebhookValue(query, value) {
  const meta = value?.metadata || {};
  const phoneNumberId = meta.phone_number_id;
  const area = resolveAreaFromPhoneNumberId(phoneNumberId);
  if (!area) {
    console.log(
      JSON.stringify({
        level: 'warn',
        message: 'Webhook: phone_number_id no coincide con ninguna area',
        phoneNumberId: phoneNumberId || null,
      })
    );
    return;
  }

  const messages = Array.isArray(value.messages) ? value.messages : [];
  for (const msg of messages) {
    const from = normalizePhone(msg.from);
    const waId = String(msg.id || '').trim();
    if (!from || !config.e164NoPlusRegex.test(from)) continue;

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
    } catch (e) {
      if (e.code === '23505') {
        continue;
      }
      throw e;
    }
  }
}

module.exports = {
  resolveAreaFromPhoneNumberId,
  persistInboundMessagesFromWebhookValue,
  extractInboundMessagePreview,
};
