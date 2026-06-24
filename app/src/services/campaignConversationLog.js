const { normalizePhone } = require('../utils/phone');
const { getWhatsAppCredentialsForArea } = require('./metaSettingsCache');

/**
 * Registra en el hilo de conversación un mensaje por envío de plantilla de campaña.
 */
async function upsertCampaignChatMessage(query, ctx) {
  const { area, campaignId, templateName, phone, contactId, waMessageId, preview } = ctx;
  const phoneNorm = normalizePhone(phone);

  const hasPreview = preview && typeof preview === 'object' && preview.bodyText;
  const bodyText = hasPreview
    ? String(preview.bodyText).slice(0, 8000)
    : `Se envió la plantilla «${String(templateName || '').slice(0, 200)}» (campaña #${campaignId}).`;

  const rawPayload = {
    campaign_id: campaignId,
    template_name: templateName,
    source: 'campaign_send',
  };
  if (hasPreview) {
    rawPayload.preview = preview;
  }

  const { phoneNumberId: linePhoneNumberId } = getWhatsAppCredentialsForArea(area);

  const convResult = await query(
    `INSERT INTO conversations (area, phone, contact_id, last_message_at, updated_at, whatsapp_phone_number_id)
     VALUES ($1, $2, $3, NOW(), NOW(), $4)
     ON CONFLICT (area, phone) DO UPDATE SET
       contact_id = COALESCE(EXCLUDED.contact_id, conversations.contact_id),
       last_message_at = NOW(),
       whatsapp_phone_number_id = COALESCE(EXCLUDED.whatsapp_phone_number_id, conversations.whatsapp_phone_number_id),
       updated_at = NOW()
     RETURNING id`,
    [area, phoneNorm, contactId, linePhoneNumberId || null]
  );
  const conversationId = convResult.rows[0].id;

  await query(
    `INSERT INTO chat_messages (conversation_id, direction, wa_message_id, body_text, message_type, raw_payload)
     VALUES ($1, 'outbound', $2, $3, 'campaign', $4::jsonb)`,
    [conversationId, waMessageId || null, bodyText, JSON.stringify(rawPayload)]
  );
}

module.exports = { upsertCampaignChatMessage };
