const config = require('../config');
const { BUSINESS_AREAS } = config;
const { normalizePhone } = require('../utils/phone');
const { downloadWhatsAppMediaBuffer, sendSessionTextMessage } = require('./metaWhatsApp');
const { saveInboundChatMediaFromBuffer } = require('../utils/chatMediaStorage');
const { sanitizeApiResponse } = require('../utils/apiSanitize');
const { getAiResponse, UNAVAILABLE_REPLY_MESSAGE } = require('./aiService');
const { parseAiConfigValue } = require('../utils/aiConfig');
const {
  getWhatsAppCredentialsForArea,
  getWabaIdOverrideForArea,
} = require('./metaSettingsCache');
const { processInboundReferral } = require('./metaCtwaAds');

const TRANSFER_TO_HUMAN_NOTICE =
  'He derivado tu consulta a un asesor. En breve te atenderán.';

/**
 * Envía texto por WhatsApp, persiste outbound y actualiza last_message_at.
 * @returns {Promise<boolean>} true si el envío y la persistencia tuvieron éxito
 */
async function persistAndSendOutbound(query, { area, conversationId, phone, text, isAi }) {
  const toSend = String(text || '').slice(0, config.MAX_SESSION_TEXT_LEN);
  if (!toSend) return false;
  try {
    const apiResponse = await sendSessionTextMessage({
      to: phone,
      text: toSend,
      area,
    });
    const msgId = apiResponse.messages?.[0]?.id || null;
    await query(
      `INSERT INTO chat_messages (conversation_id, direction, wa_message_id, body_text, message_type, raw_payload, is_ai)
       VALUES ($1, 'outbound', $2, $3, 'text', $4::jsonb, $5)`,
      [conversationId, msgId, toSend, JSON.stringify(sanitizeApiResponse(apiResponse)), Boolean(isAi)]
    );
    await query(
      `UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [conversationId]
    );
    return true;
  } catch (e) {
    console.log(
      JSON.stringify({
        level: 'warn',
        message: 'persistAndSendOutbound: fallo al enviar o guardar mensaje',
        area,
        conversationId,
        error: e.message,
      })
    );
    return false;
  }
}

function resolveAreaFromPhoneNumberId(phoneNumberId) {
  const id = String(phoneNumberId || '').trim();
  const lines = BUSINESS_AREAS.map((area) => ({
    area,
    pid: getWhatsAppCredentialsForArea(area).phoneNumberId,
  })).filter((x) => String(x.pid || '').trim());
  const matching = lines.filter((x) => x.pid === id);
  if (matching.length === 1) return matching[0].area;
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
    for (const slug of BUSINESS_AREAS) {
      const w = String(getWabaIdOverrideForArea(slug) || '').trim();
      if (w && w === waba) return { area: slug, source: 'waba_entry_id' };
    }
  }

  const lines = BUSINESS_AREAS.map((area) => ({
    area,
    ...getWhatsAppCredentialsForArea(area),
  })).filter((x) => !!x.phoneNumberId);
  if (lines.length === 1) return { area: lines[0].area, source: 'single_configured_line' };

  return { area: null, source: null };
}

function extractInboundMessagePreview(msg) {
  const type = String(msg?.type || 'unknown').trim();
  if (type === 'text') {
    const body = String(msg?.text?.body ?? '').trim();
    return { messageType: 'text', bodyText: body || '(vacío)' };
  }
  if (type === 'image') {
    const cap = String(msg?.image?.caption ?? '').trim();
    return { messageType: 'image', bodyText: cap || '[Imagen]' };
  }
  if (type === 'video') {
    const cap = String(msg?.video?.caption ?? '').trim();
    return { messageType: 'video', bodyText: cap || '[Video]' };
  }
  if (type === 'document') {
    const fn = String(msg?.document?.filename ?? '').trim();
    const cap = String(msg?.document?.caption ?? '').trim();
    const parts = [];
    if (fn) parts.push(fn);
    if (cap) parts.push(cap);
    return { messageType: 'document', bodyText: parts.length ? parts.join(' · ') : '[Documento]' };
  }
  if (type === 'audio') {
    const isVoice = msg.audio?.voice === true;
    return {
      messageType: isVoice ? 'voice' : 'audio',
      bodyText: isVoice ? '[Nota de voz]' : '[Audio]',
    };
  }
  if (type === 'voice') return { messageType: 'voice', bodyText: '[Nota de voz]' };
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

/** Referencia a media en payload de webhook (Graph API). */
function extractInboundMediaRef(msg) {
  const t = String(msg?.type || '').trim();
  if (t === 'image' && msg.image?.id) return { mediaId: String(msg.image.id) };
  if (t === 'video' && msg.video?.id) return { mediaId: String(msg.video.id) };
  if (t === 'audio' && msg.audio?.id) return { mediaId: String(msg.audio.id) };
  if (t === 'voice' && msg.voice?.id) return { mediaId: String(msg.voice.id) };
  if (t === 'document' && msg.document?.id) return { mediaId: String(msg.document.id) };
  if (t === 'sticker' && msg.sticker?.id) return { mediaId: String(msg.sticker.id) };
  return null;
}

async function maybeAutoReplyWithAi(
  query,
  { area, conversationId, messageType, bodyText, phone, chatMessageId, userText: userTextExplicit }
) {
  if (String(messageType || '').trim() !== 'text') return;
  if (!String(process.env.GROQ_API_KEY || '').trim()) return;

  const convRow = await query(`SELECT phone, status FROM conversations WHERE id = $1`, [conversationId]);
  if (convRow.rows.length === 0) return;
  const conv = convRow.rows[0];
  if (String(conv.status || '').trim() !== 'bot') return;

  const settingsRow = await query(
    `SELECT value FROM app_settings WHERE area = $1 AND key = 'ai_config'`,
    [area]
  );
  const aiCfg = parseAiConfigValue(settingsRow.rows[0]?.value);
  if (!aiCfg || !aiCfg.enabled) return;

  const userText = String(userTextExplicit ?? '').trim();
  if (!userText) return;

  const histResult = await query(
    `SELECT direction, body_text FROM chat_messages
     WHERE conversation_id = $1 AND id <> $2
     ORDER BY created_at DESC
     LIMIT 4`,
    [conversationId, chatMessageId]
  );
  const historyRows = histResult.rows.slice().reverse();
  const history = historyRows.map((r) => ({
    role: String(r.direction) === 'inbound' ? 'user' : 'model',
    text: String(r.body_text || '').slice(0, 8000),
  }));

  let replyText;
  try {
    console.log('Iniciando generación de respuesta con IA...');
    replyText = await getAiResponse(userText, history, aiCfg, area);
  } catch (e) {
    console.log(
      JSON.stringify({
        level: 'warn',
        message: 'Auto-reply IA (Groq): error',
        area,
        conversationId,
        error: e.message,
      })
    );
    replyText = null;
  }

  const iaFallo = replyText == null || replyText === UNAVAILABLE_REPLY_MESSAGE;
  if (iaFallo) {
    await query(`UPDATE conversations SET status = 'human', updated_at = NOW() WHERE id = $1`, [
      conversationId,
    ]);
    await persistAndSendOutbound(query, {
      area,
      conversationId,
      phone,
      text: UNAVAILABLE_REPLY_MESSAGE,
      isAi: false,
    });
    console.log(`[Fallback] Error en IA. Conversación ${conversationId} movida a Asesor (status human).`);
    return;
  }

  const transferKw = String(aiCfg.transfer_keyword || '[TRANSFERIR]').trim();
  if (transferKw && replyText.includes(transferKw)) {
    await persistAndSendOutbound(query, {
      area,
      conversationId,
      phone,
      text: TRANSFER_TO_HUMAN_NOTICE,
      isAi: true,
    });
    await query(`UPDATE conversations SET status = 'human', updated_at = NOW() WHERE id = $1`, [
      conversationId,
    ]);
    return;
  }

  await persistAndSendOutbound(query, {
    area,
    conversationId,
    phone,
    text: replyText,
    isAi: true,
  });
}

async function tryStoreInboundMedia(query, { chatMessageId, msg, area, conversationId }) {
  const ref = extractInboundMediaRef(msg);
  if (!ref) return;

  try {
    const { buffer, mimeType } = await downloadWhatsAppMediaBuffer({
      mediaId: ref.mediaId,
      area,
    });
    const localPreview = await saveInboundChatMediaFromBuffer({
      buffer,
      conversationId,
      mimeType,
    });
    await query(
      `UPDATE chat_messages SET raw_payload = COALESCE(raw_payload, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ local_preview: localPreview }), chatMessageId]
    );
  } catch (e) {
    console.log(
      JSON.stringify({
        level: 'warn',
        message: 'Webhook inbound: no se pudo descargar o guardar media entrante',
        error: e.message,
        mediaId: ref.mediaId,
      })
    );
  }
}

async function resolveAreaFromSenderPhones(query, senderPhones) {
  if (!Array.isArray(senderPhones) || senderPhones.length === 0) return null;
  const phones = Array.from(
    new Set(senderPhones.map((p) => String(p || '').trim()).filter(Boolean))
  );
  if (phones.length === 0) return null;

  const placeholders = phones.map((_, i) => `$${i + 1}`).join(', ');
  const params = phones;

  const [contactAreas, conversationAreas, campaignAreas] = await Promise.all([
    query(`SELECT DISTINCT area FROM contacts WHERE phone IN (${placeholders})`, params),
    query(`SELECT DISTINCT area FROM conversations WHERE phone IN (${placeholders})`, params),
    query(
      `SELECT DISTINCT c.area
       FROM campaign_logs cl
       JOIN campaigns c ON c.id = cl.campaign_id
       WHERE cl.phone IN (${placeholders})`,
      params
    ),
  ]);

  const areas = new Set([
    ...contactAreas.rows.map((r) => String(r.area || '').trim()),
    ...conversationAreas.rows.map((r) => String(r.area || '').trim()),
    ...campaignAreas.rows.map((r) => String(r.area || '').trim()),
  ]);

  areas.delete('');
  if (areas.size === 1) return Array.from(areas)[0];
  return null;
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
  let { area, source } = resolveInboundArea(value, wabaEntryId);
  const metaPid = value?.metadata?.phone_number_id ?? null;
  const senderPhones = messages.map((m) => normalizePhone(m.from));

  const areaByPhone = await resolveAreaFromSenderPhones(query, senderPhones);
  if (areaByPhone) {
    if (!area) {
      area = areaByPhone;
      source = 'sender_phone_db';
    } else if (area !== areaByPhone) {
      console.log(
        JSON.stringify({
          level: 'warn',
          message:
            'Webhook inbound: metadata.phone_number_id apunta a un área distinta a contactos/conversaciones/campañas; se usa el área de la BD',
          resolvedByPhoneNumberId: area,
          resolvedByPhoneDb: areaByPhone,
          phoneNumberId: metaPid,
        })
      );
      area = areaByPhone;
      source = 'sender_phone_db_override';
    }
  }

  if (!area) {
    console.log(
      JSON.stringify({
        level: 'warn',
        message: 'Webhook: no se pudo resolver area para mensajes entrantes',
        phoneNumberId: metaPid,
        wabaEntryId: wabaEntryId || null,
        webhookField: context.field || null,
        hint:
          'Define WABA_ID_TI / WABA_ID_PAM / WABA_ID_EDUCACION o deja solo una linea PHONE_NUMBER_ID_* configurada.',
      })
    );
    return;
  }

  if (source !== 'phone_number_id' && source !== 'sender_phone_db_override') {
    console.log(
      JSON.stringify({
        level: 'info',
        message: 'Webhook inbound: area resuelta por fuente alternativa a metadata.phone_number_id',
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
      `INSERT INTO conversations (area, phone, contact_id, last_user_message_at, last_message_at, inbox_unread, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW(), TRUE, NOW())
       ON CONFLICT (area, phone) DO UPDATE SET
         contact_id = COALESCE(EXCLUDED.contact_id, conversations.contact_id),
         last_user_message_at = NOW(),
         last_message_at = NOW(),
         inbox_unread = TRUE,
         updated_at = NOW()
       RETURNING id`,
      [area, from, contactId]
    );
    const conversationId = convResult.rows[0].id;

    try {
      await processInboundReferral(query, {
        area,
        conversationId,
        contactId,
        phone: from,
        msg,
      });
    } catch (referralErr) {
      console.log(
        JSON.stringify({
          level: 'warn',
          message: 'Meta ad referral processing failed',
          error: referralErr.message,
          conversationId,
        })
      );
    }

    try {
      const insertResult = await query(
        `INSERT INTO chat_messages (conversation_id, direction, wa_message_id, body_text, message_type, raw_payload)
         VALUES ($1, 'inbound', $2, $3, $4, $5::jsonb)
         RETURNING id`,
        [conversationId, waId || null, bodyText.slice(0, 8000), messageType, JSON.stringify(msg)]
      );
      const chatMessageId = insertResult.rows[0].id;
      saved += 1;
      await tryStoreInboundMedia(query, { chatMessageId, msg, area, conversationId });
      const userTextForAi =
        String(messageType || '').trim() === 'text'
          ? String(msg?.text?.body ?? '').trim()
          : String(bodyText || '').trim();
      await maybeAutoReplyWithAi(query, {
        area,
        conversationId,
        messageType,
        bodyText,
        phone: from,
        chatMessageId,
        userText: userTextForAi,
      });
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
  resolveAreaFromSenderPhones,
  persistInboundMessagesFromWebhookValue,
  extractInboundMessagePreview,
  extractInboundMediaRef,
};
