const {
  buildCampaignMessagePreview,
  applyCampaignImageFallback,
} = require('./campaignMessagePreview');
const { parseCampaignPayload, buildSendContextFromCampaign } = require('./campaignSendContext');
const {
  fetchContactAttributesMap,
  buildParamsForContact,
} = require('./contactTemplateParams');
const { normalizePhone } = require('../utils/phone');

const BATCH_SIZE = 200;
const MIGRATION_FLAG = 'migration.campaign_chat_preview_backfill_v1';

function resolveContactId(row) {
  if (Number.isInteger(row.log_contact_id) && row.log_contact_id > 0) {
    return row.log_contact_id;
  }
  if (Number.isInteger(row.conv_contact_id) && row.conv_contact_id > 0) {
    return row.conv_contact_id;
  }
  return null;
}

async function fetchContactsByIds(query, contactIds) {
  if (!contactIds.length) return new Map();
  const r = await query(
    `SELECT id, name, phone FROM contacts WHERE id = ANY($1::int[])`,
    [contactIds]
  );
  const map = new Map();
  for (const row of r.rows) {
    map.set(row.id, row);
  }
  return map;
}

async function fetchContactsByPhones(query, area, phones) {
  if (!phones.length) return new Map();
  const r = await query(
    `SELECT DISTINCT ON (phone) id, name, phone
     FROM contacts
     WHERE area = $1 AND phone = ANY($2::varchar[])
     ORDER BY phone, updated_at DESC NULLS LAST`,
    [area, phones]
  );
  const map = new Map();
  for (const row of r.rows) {
    map.set(normalizePhone(row.phone), row);
  }
  return map;
}

async function fetchTemplateRow(query, area, templateName, cache) {
  const key = `${area}::${templateName}`;
  if (cache.has(key)) return cache.get(key);

  const r = await query(
    `SELECT id, name, language, category, components_json
     FROM whatsapp_templates
     WHERE area = $1 AND name = $2
     ORDER BY synced_at DESC NULLS LAST, id DESC
     LIMIT 1`,
    [area, templateName]
  );
  const row = r.rows[0] || null;
  cache.set(key, row);
  return row;
}

async function fetchCampaignRow(query, campaignId, cache) {
  if (!Number.isInteger(campaignId) || campaignId <= 0) return null;
  if (cache.has(campaignId)) return cache.get(campaignId);

  const r = await query(
    `SELECT id, area, template_name, message_text, image_url, campaign_payload
     FROM campaigns
     WHERE id = $1`,
    [campaignId]
  );
  const row = r.rows[0] || null;
  cache.set(campaignId, row);
  return row;
}

function rebuildPreviewForRow(row, sendCtx, contact, attrs) {
  const resolvedParams = sendCtx.paramMapping
    ? buildParamsForContact(sendCtx.staticParams, sendCtx.paramMapping, contact, attrs)
    : sendCtx.staticParams;

  const { preview } = buildCampaignMessagePreview(
    sendCtx.def,
    sendCtx.templateSnapshot.components_json,
    resolvedParams
  );

  if (!preview.bodyText && !preview.headerText) {
    return null;
  }

  return preview;
}

/**
 * Reconstruye raw_payload.preview en mensajes de campaña antiguos.
 */
async function backfillCampaignChatPreviews(query) {
  const done = await query(`SELECT 1 AS ok FROM app_settings WHERE area = 'global' AND key = $1`, [
    MIGRATION_FLAG,
  ]);
  if (done.rows.length > 0) {
    return { skipped: true, reason: 'already_done' };
  }

  const stats = { scanned: 0, updated: 0, skipped: 0, errors: 0 };
  const campaignCache = new Map();
  const templateCache = new Map();
  let lastId = 0;

  for (;;) {
    const batch = await query(
      `SELECT
         cm.id,
         cm.wa_message_id,
         cm.raw_payload,
         conv.area,
         conv.phone AS conv_phone,
         conv.contact_id AS conv_contact_id,
         cl.contact_id AS log_contact_id
       FROM chat_messages cm
       JOIN conversations conv ON conv.id = cm.conversation_id
       LEFT JOIN campaign_logs cl ON cl.whatsapp_message_id = cm.wa_message_id
       WHERE cm.message_type = 'campaign'
         AND (cm.raw_payload IS NULL OR cm.raw_payload->'preview' IS NULL)
         AND cm.id > $1
       ORDER BY cm.id ASC
       LIMIT $2`,
      [lastId, BATCH_SIZE]
    );

    if (batch.rowCount === 0) break;

    const contactIds = new Set();
    const phonesByArea = new Map();

    for (const row of batch.rows) {
      const contactId = resolveContactId(row);
      if (contactId) contactIds.add(contactId);
      const area = row.area;
      const phone = normalizePhone(row.conv_phone);
      if (area && phone) {
        if (!phonesByArea.has(area)) phonesByArea.set(area, new Set());
        phonesByArea.get(area).add(phone);
      }
    }

    const contactsById = await fetchContactsByIds(query, [...contactIds]);
    const contactsByAreaPhone = new Map();
    for (const [area, phones] of phonesByArea.entries()) {
      const map = await fetchContactsByPhones(query, area, [...phones]);
      contactsByAreaPhone.set(area, map);
    }

    const attrsMap = await fetchContactAttributesMap(query, [...contactIds]);

    for (const row of batch.rows) {
      stats.scanned += 1;
      lastId = row.id;

      try {
        const raw =
          row.raw_payload && typeof row.raw_payload === 'object'
            ? row.raw_payload
            : parseCampaignPayload(row.raw_payload) || {};

        const campaignId = parseInt(String(raw.campaign_id || ''), 10);
        const templateName = String(raw.template_name || '').trim();
        let campaignRow = await fetchCampaignRow(query, campaignId, campaignCache);

        const area = campaignRow?.area || row.area;
        const tplName = campaignRow?.template_name || templateName;
        if (!area || !tplName) {
          stats.skipped += 1;
          continue;
        }

        if (!campaignRow) {
          campaignRow = {
            area,
            template_name: tplName,
            message_text: '',
            image_url: null,
            campaign_payload: null,
          };
        }

        const templateRow = await fetchTemplateRow(query, area, tplName, templateCache);
        const sendCtx = buildSendContextFromCampaign(campaignRow, templateRow);
        if (!sendCtx) {
          stats.skipped += 1;
          continue;
        }

        let contact = null;
        const contactId = resolveContactId(row);
        if (contactId) {
          contact = contactsById.get(contactId) || null;
        }
        if (!contact) {
          const phone = normalizePhone(row.conv_phone);
          const phoneMap = contactsByAreaPhone.get(area);
          contact = phoneMap?.get(phone) || { id: contactId, name: '', phone: row.conv_phone };
        }

        const attrs = contact.id ? attrsMap.get(contact.id) : null;
        let preview = rebuildPreviewForRow(row, sendCtx, contact, attrs);
        if (!preview) {
          stats.skipped += 1;
          continue;
        }
        preview = applyCampaignImageFallback(preview, campaignRow.image_url);

        const nextPayload = {
          ...raw,
          campaign_id: campaignId || raw.campaign_id || null,
          template_name: tplName,
          source: raw.source || 'campaign_send',
          preview,
        };

        await query(
          `UPDATE chat_messages
           SET body_text = $2,
               raw_payload = $3::jsonb
           WHERE id = $1`,
          [row.id, String(preview.bodyText || '').slice(0, 8000), JSON.stringify(nextPayload)]
        );
        stats.updated += 1;
      } catch {
        stats.errors += 1;
      }
    }
  }

  await query(
    `INSERT INTO app_settings (area, key, value, updated_at) VALUES ('global', $1, $2, NOW())
     ON CONFLICT (area, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [MIGRATION_FLAG, JSON.stringify(stats)]
  );

  return stats;
}

const MEDIA_MIGRATION_FLAG = 'migration.campaign_chat_preview_media_v1';

/**
 * Completa headerMediaUrl en previews ya backfilled que usan cabecera imagen.
 */
async function backfillCampaignChatPreviewMedia(query) {
  const done = await query(`SELECT 1 AS ok FROM app_settings WHERE area = 'global' AND key = $1`, [
    MEDIA_MIGRATION_FLAG,
  ]);
  if (done.rows.length > 0) {
    return { skipped: true, reason: 'already_done' };
  }

  const r = await query(
    `SELECT cm.id, cm.raw_payload, c.image_url
     FROM chat_messages cm
     JOIN campaigns c ON c.id = (cm.raw_payload->>'campaign_id')::int
     WHERE cm.message_type = 'campaign'
       AND cm.raw_payload->'preview' IS NOT NULL
       AND cm.raw_payload->'preview'->>'headerMediaType' = 'image'
       AND (
         cm.raw_payload->'preview'->>'headerMediaUrl' IS NULL
         OR TRIM(cm.raw_payload->'preview'->>'headerMediaUrl') = ''
       )
       AND c.image_url IS NOT NULL
       AND TRIM(c.image_url) <> ''`
  );

  let updated = 0;
  for (const row of r.rows) {
    const raw =
      row.raw_payload && typeof row.raw_payload === 'object'
        ? row.raw_payload
        : parseCampaignPayload(row.raw_payload) || {};
    const preview = applyCampaignImageFallback(raw.preview, row.image_url);
    if (!preview?.headerMediaUrl || preview.headerMediaUrl === raw.preview?.headerMediaUrl) {
      continue;
    }
    const nextPayload = { ...raw, preview };
    await query(
      `UPDATE chat_messages SET raw_payload = $2::jsonb WHERE id = $1`,
      [row.id, JSON.stringify(nextPayload)]
    );
    updated += 1;
  }

  await query(
    `INSERT INTO app_settings (area, key, value, updated_at) VALUES ('global', $1, $2, NOW())
     ON CONFLICT (area, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [MEDIA_MIGRATION_FLAG, JSON.stringify({ updated })]
  );

  return { updated };
}

module.exports = {
  backfillCampaignChatPreviews,
  backfillCampaignChatPreviewMedia,
  buildSendContextFromCampaign,
  parseCampaignPayload,
  MIGRATION_FLAG,
};
