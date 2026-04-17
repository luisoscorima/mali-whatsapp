const { normalizePhone } = require('../utils/phone');

/**
 * Registra en el hilo de conversación un único mensaje de sistema por envío
 * de plantilla de campaña (Meta ya devolvió message id).
 */
async function upsertCampaignChatMessage(query, ctx) {
  const { area, campaignId, templateName, phone, contactId, waMessageId } = ctx;
  const phoneNorm = normalizePhone(phone);
  const bodyText = `Se envió la plantilla «${String(templateName || '').slice(0, 200)}» (campaña #${campaignId}).`;
  const rawPayload = JSON.stringify({
    campaign_id: campaignId,
    template_name: templateName,
    source: 'campaign_send',
  });

  const convResult = await query(
    `INSERT INTO conversations (area, phone, contact_id, last_message_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT (area, phone) DO UPDATE SET
       contact_id = COALESCE(EXCLUDED.contact_id, conversations.contact_id),
       last_message_at = NOW(),
       updated_at = NOW()
     RETURNING id`,
    [area, phoneNorm, contactId]
  );
  const conversationId = convResult.rows[0].id;

  await query(
    `INSERT INTO chat_messages (conversation_id, direction, wa_message_id, body_text, message_type, raw_payload)
     VALUES ($1, 'outbound', $2, $3, 'campaign', $4::jsonb)`,
    [conversationId, waMessageId || null, bodyText.slice(0, 8000), rawPayload]
  );
}

module.exports = { upsertCampaignChatMessage };
