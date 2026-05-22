/**
 * Anuncios Click-to-WhatsApp (referral en webhook de Meta).
 */

function extractMessageReferral(msg) {
  if (!msg || typeof msg !== 'object') return null;
  if (msg.referral && typeof msg.referral === 'object') return msg.referral;
  if (msg.context?.referral && typeof msg.context.referral === 'object') {
    return msg.context.referral;
  }
  return null;
}

function inferAdPlatform(sourceUrl) {
  const u = String(sourceUrl || '').toLowerCase();
  if (u.includes('instagram') || u.includes('ig.me')) return 'instagram';
  if (u.includes('facebook') || u.includes('fb.me') || u.includes('fb.com')) return 'facebook';
  return 'other';
}

function formatAdPlatformLabel(platform) {
  if (platform === 'facebook') return 'Facebook';
  if (platform === 'instagram') return 'Instagram';
  return 'Meta';
}

function referralAdKey(referral) {
  const sourceId = String(referral.source_id || '').trim();
  if (sourceId) return sourceId;
  const clid = String(referral.ctwa_clid || '').trim();
  if (clid) return `clid:${clid.slice(0, 120)}`;
  return null;
}

function adDisplayLabel(row) {
  if (!row) return '';
  const name = String(row.display_name || '').trim();
  if (name) return name;
  return String(row.meta_source_id || '').trim() || 'Anuncio';
}

async function upsertMetaCtwaAd(query, { area, referral }) {
  const metaSourceId = referralAdKey(referral);
  if (!metaSourceId) return null;

  const platform = inferAdPlatform(referral.source_url);
  const snapshot = { ...referral };

  const r = await query(
    `INSERT INTO meta_ctwa_ads (
       area, meta_source_id, ad_platform, source_url, source_type,
       headline, body, media_type, image_url, ctwa_clid, referral_snapshot,
       first_seen_at, last_seen_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW(), NOW(), NOW())
     ON CONFLICT (area, meta_source_id) DO UPDATE SET
       ad_platform = EXCLUDED.ad_platform,
       source_url = COALESCE(EXCLUDED.source_url, meta_ctwa_ads.source_url),
       source_type = COALESCE(EXCLUDED.source_type, meta_ctwa_ads.source_type),
       headline = COALESCE(EXCLUDED.headline, meta_ctwa_ads.headline),
       body = COALESCE(EXCLUDED.body, meta_ctwa_ads.body),
       media_type = COALESCE(EXCLUDED.media_type, meta_ctwa_ads.media_type),
       image_url = COALESCE(EXCLUDED.image_url, meta_ctwa_ads.image_url),
       ctwa_clid = COALESCE(EXCLUDED.ctwa_clid, meta_ctwa_ads.ctwa_clid),
       referral_snapshot = EXCLUDED.referral_snapshot,
       last_seen_at = NOW(),
       updated_at = NOW()
     RETURNING id, meta_source_id, display_name, ad_platform, headline, body, source_url`,
    [
      area,
      metaSourceId,
      platform,
      referral.source_url || null,
      referral.source_type || null,
      referral.headline || null,
      referral.body || null,
      referral.media_type || null,
      referral.image_url || null,
      referral.ctwa_clid || null,
      JSON.stringify(snapshot),
    ]
  );
  return r.rows[0] || null;
}

async function recordMetaCtwaLead(query, { area, adId, conversationId, contactId, phone }) {
  const ins = await query(
    `INSERT INTO meta_ctwa_ad_leads (area, meta_ctwa_ad_id, conversation_id, contact_id, phone, first_message_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (area, meta_ctwa_ad_id, conversation_id) DO NOTHING
     RETURNING id`,
    [area, adId, conversationId, contactId, phone]
  );
  if (ins.rowCount > 0) {
    await query(
      `UPDATE meta_ctwa_ads SET lead_count = lead_count + 1, updated_at = NOW() WHERE id = $1 AND area = $2`,
      [adId, area]
    );
  }
}

async function processInboundReferral(query, { area, conversationId, contactId, phone, msg }) {
  const referral = extractMessageReferral(msg);
  if (!referral) return null;

  const ad = await upsertMetaCtwaAd(query, { area, referral });
  if (!ad) return null;

  await recordMetaCtwaLead(query, {
    area,
    adId: ad.id,
    conversationId,
    contactId,
    phone,
  });

  await query(
    `UPDATE conversations SET
       meta_ctwa_ad_id = $1,
       attribution = $2::jsonb,
       updated_at = NOW()
     WHERE id = $3 AND area = $4`,
    [
      ad.id,
      JSON.stringify({
        referral,
        ad_platform: ad.ad_platform,
        meta_source_id: ad.meta_source_id,
        applied_at: new Date().toISOString(),
      }),
      conversationId,
      area,
    ]
  );

  return { ad, referral };
}

async function loadMetaAdsList(query, area) {
  const r = await query(
    `SELECT id, meta_source_id, display_name, ad_platform, source_url, source_type,
            headline, body, lead_count, first_seen_at, last_seen_at
     FROM meta_ctwa_ads
     WHERE area = $1
     ORDER BY last_seen_at DESC NULLS LAST, id DESC`,
    [area]
  );
  return r.rows;
}

async function loadMetaAdDetail(query, area, adId) {
  const adR = await query(
    `SELECT id, meta_source_id, display_name, ad_platform, source_url, source_type,
            headline, body, media_type, image_url, ctwa_clid, lead_count,
            first_seen_at, last_seen_at, referral_snapshot
     FROM meta_ctwa_ads
     WHERE id = $1 AND area = $2`,
    [adId, area]
  );
  if (adR.rowCount === 0) return null;

  const leadsR = await query(
    `SELECT l.phone, l.first_message_at, c.name AS contact_name, l.conversation_id
     FROM meta_ctwa_ad_leads l
     LEFT JOIN contacts c ON c.id = l.contact_id
     WHERE l.meta_ctwa_ad_id = $1 AND l.area = $2
     ORDER BY l.first_message_at DESC`,
    [adId, area]
  );

  return { ad: adR.rows[0], leads: leadsR.rows };
}

async function updateMetaAdDisplayName(query, { area, adId, displayName }) {
  const name = String(displayName || '').trim().slice(0, 200) || null;
  await query(
    `UPDATE meta_ctwa_ads SET display_name = $1, updated_at = NOW() WHERE id = $2 AND area = $3`,
    [name, adId, area]
  );
}

module.exports = {
  extractMessageReferral,
  inferAdPlatform,
  formatAdPlatformLabel,
  referralAdKey,
  adDisplayLabel,
  processInboundReferral,
  loadMetaAdsList,
  loadMetaAdDetail,
  updateMetaAdDisplayName,
};
