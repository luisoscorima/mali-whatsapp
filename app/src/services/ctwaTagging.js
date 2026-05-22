/**
 * Etiquetado automático desde anuncios Click-to-WhatsApp (referral en webhook).
 */

async function loadActiveCtwaRules(query, area) {
  const r = await query(
    `SELECT id, meta_source_id, headline_pattern, segment_slug, tag_label
     FROM ctwa_tag_rules
     WHERE area = $1 AND active = TRUE`,
    [area]
  );
  return r.rows;
}

function matchCtwaRule(rules, referral) {
  if (!referral || typeof referral !== 'object') return null;
  const sourceId = String(referral.source_id || '').trim();
  const headline = String(referral.headline || '').trim().toLowerCase();

  for (const rule of rules) {
    const rid = String(rule.meta_source_id || '').trim();
    if (rid && sourceId && rid === sourceId) return rule;
    const pat = String(rule.headline_pattern || '').trim().toLowerCase();
    if (pat && headline && headline.includes(pat)) return rule;
  }
  return null;
}

async function applyCtwaRuleToConversation(query, { area, conversationId, contactId, rule, referral }) {
  if (!rule) return;

  await query(
    `UPDATE conversations SET attribution = $1::jsonb, updated_at = NOW() WHERE id = $2 AND area = $3`,
    [
      JSON.stringify({ referral, applied_at: new Date().toISOString(), rule_id: rule.id }),
      conversationId,
      area,
    ]
  );

  if (contactId && rule.segment_slug) {
    await query(
      `INSERT INTO contact_segments (contact_id, area, segment_slug)
       VALUES ($1, $2, $3)
       ON CONFLICT (contact_id, segment_slug) DO NOTHING`,
      [contactId, area, rule.segment_slug]
    );
  }

  if (rule.tag_label) {
    await query(
      `INSERT INTO conversation_tags (conversation_id, label, source, meta_source_id)
       VALUES ($1, $2, 'ctwa', $3)
       ON CONFLICT (conversation_id, label) DO NOTHING`,
      [conversationId, rule.tag_label, referral?.source_id || null]
    );
  }
}

module.exports = {
  loadActiveCtwaRules,
  matchCtwaRule,
  applyCtwaRuleToConversation,
};
