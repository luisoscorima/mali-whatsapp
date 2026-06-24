const { buildTemplateDefinition } = require('./templateParser');

function parseCampaignPayload(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return typeof raw === 'object' ? raw : null;
}

function buildSendContextFromCampaign(campaignRow, templateRow) {
  if (!campaignRow) return null;

  const payload = parseCampaignPayload(campaignRow.campaign_payload);
  let templateSnapshot = payload?.templateSnapshot || null;

  if ((!templateSnapshot || !templateSnapshot.components_json) && templateRow) {
    templateSnapshot = {
      id: templateRow.id,
      name: templateRow.name,
      language: templateRow.language,
      category: templateRow.category || '',
      components_json: templateRow.components_json,
    };
  }

  if (!templateSnapshot?.components_json) return null;

  const def = buildTemplateDefinition({
    id: templateSnapshot.id || 0,
    name: templateSnapshot.name || campaignRow.template_name,
    language: templateSnapshot.language,
    category: templateSnapshot.category || '',
    status: 'APPROVED',
    components_json: templateSnapshot.components_json,
  });

  const staticParams =
    payload?.staticParams && typeof payload.staticParams === 'object'
      ? payload.staticParams
      : (() => {
          const { parseStaticParamsFromMessageText } = require('./campaignMessagePreview');
          return parseStaticParamsFromMessageText(def, campaignRow.message_text, campaignRow.image_url);
        })();

  return {
    def,
    templateSnapshot,
    staticParams,
    paramMapping: payload?.paramMapping || null,
  };
}

module.exports = {
  parseCampaignPayload,
  buildSendContextFromCampaign,
};
