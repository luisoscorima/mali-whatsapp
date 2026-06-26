const {
  resumeQueuedCampaigns,
  resumeInterruptedCampaigns,
  promoteDueScheduledCampaigns,
  promoteDueCampaignRetries,
} = require('../services/campaignSender');
const { createRouteContext } = require('./shared/routeContext');
const { registerAuth } = require('./registerAuth');
const { registerDashboard } = require('./registerDashboard');
const { registerInboxViews } = require('./registerInboxViews');
const { registerSystem } = require('./registerSystem');
const { registerTemplates } = require('./registerTemplates');
const { registerContacts } = require('./registerContacts');
const { registerSegments } = require('./registerSegments');
const { registerCampaigns } = require('./registerCampaigns');
const { registerConversations } = require('./registerConversations');
const { registerWebhook } = require('./registerWebhook');
const { registerAdmin } = require('./registerAdmin');
const { registerSettingsApi } = require('./registerSettingsApi');
const { registerSettingsViews } = require('./registerSettingsViews');
const { registerMetaAds } = require('./registerMetaAds');
const { registerAttributeDefinitions } = require('./registerAttributeDefinitions');

function createRegisterRoutes({ query, pool, appPath }) {
  const ctx = createRouteContext({ query, pool, appPath });

  function register(app) {
    registerAuth(app, ctx);
    registerAdmin(app, ctx);
    registerDashboard(app, ctx);
    registerSystem(app, ctx);
    registerInboxViews(app, ctx);
    registerTemplates(app, ctx);
    registerContacts(app, ctx);
    registerSegments(app, ctx);
    registerCampaigns(app, ctx);
    registerConversations(app, ctx);
    registerSettingsApi(app, ctx);
    registerSettingsViews(app, ctx);
    registerMetaAds(app, ctx);
    registerAttributeDefinitions(app, ctx);
    registerWebhook(app, ctx);
  }

  return {
    register,
    resumeQueuedCampaigns: () => resumeQueuedCampaigns(query),
    resumeInterruptedCampaigns: () => resumeInterruptedCampaigns(query),
    promoteDueScheduledCampaigns: () => promoteDueScheduledCampaigns(query),
    promoteDueCampaignRetries: () => promoteDueCampaignRetries(query),
  };
}

module.exports = { createRegisterRoutes };
