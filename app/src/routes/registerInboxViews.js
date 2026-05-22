const { escapeForLikePattern } = require('../utils/searchEscape');
const { fetchCampaignFailedLogs } = require('../services/campaignFailedLogs');
const { fetchCampaignRetryStats } = require('../services/campaignRetry');
const { fetchCampaignResponderMetrics } = require('../services/campaignResponders');
const { parseAiConfigValue } = require('../utils/aiConfig');
const {
  CAMPAIGN_LOG_STATUS_SQL,
  sqlInList,
  SALIDA_OK_STATUSES,
  ERROR_STATUSES,
} = require('../utils/campaignLogStatuses');

const LOG_STATUS = CAMPAIGN_LOG_STATUS_SQL;
const SALIDA_OK_IN = sqlInList(SALIDA_OK_STATUSES);
const ERROR_IN = sqlInList(ERROR_STATUSES);
const DEFAULT_PHONE_PREFIX = '51';
const COUNTRY_CALLING_CODES = new Set([
  '1', '7', '20', '27', '30', '31', '32', '33', '34', '39', '40', '41', '43', '44', '45', '46',
  '47', '48', '49', '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64',
  '65', '66', '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98', '211', '212',
  '213', '216', '218', '220', '221', '222', '223', '224', '225', '226', '227', '228', '229', '230',
  '231', '232', '233', '234', '235', '236', '237', '238', '239', '240', '241', '242', '243', '244',
  '245', '246', '248', '249', '250', '251', '252', '253', '254', '255', '256', '257', '258', '260',
  '261', '262', '263', '264', '265', '266', '267', '268', '269', '290', '291', '297', '298', '299',
  '350', '351', '352', '353', '354', '355', '356', '357', '358', '359', '370', '371', '372', '373',
  '374', '375', '376', '377', '378', '380', '381', '382', '385', '386', '387', '389', '420', '421',
  '423', '500', '501', '502', '503', '504', '505', '506', '507', '508', '509', '590', '591', '592',
  '593', '594', '595', '596', '597', '598', '599', '670', '672', '673', '674', '675', '676', '677',
  '678', '679', '680', '681', '682', '683', '685', '686', '687', '688', '689', '690', '691', '692',
  '850', '852', '853', '855', '856', '870', '880', '886', '960', '961', '962', '963', '964', '965',
  '966', '967', '968', '970', '971', '972', '973', '974', '975', '976', '992', '993', '994', '995',
  '996', '998',
]);

function inferPrefillPhoneParts(fullDigits, forcedPrefix = '', forcedLocal = '') {
  const digits = String(fullDigits || '').replace(/\D/g, '');
  const prefixForced = String(forcedPrefix || '').replace(/\D/g, '');
  const localForced = String(forcedLocal || '').replace(/\D/g, '');

  if (prefixForced) {
    let local = localForced || digits;
    if (!local && digits.startsWith(prefixForced) && digits.length > prefixForced.length) {
      local = digits.slice(prefixForced.length);
    }
    if (local.startsWith(prefixForced) && local.length > prefixForced.length) {
      local = local.slice(prefixForced.length);
    }
    return { prefix: prefixForced.slice(0, 4), local: local.slice(0, 20) };
  }

  if (localForced) {
    if (digits.startsWith(DEFAULT_PHONE_PREFIX) && localForced.length === 9 && localForced.startsWith('9')) {
      return { prefix: DEFAULT_PHONE_PREFIX, local: localForced.slice(0, 20) };
    }
    return { prefix: DEFAULT_PHONE_PREFIX, local: localForced.slice(0, 20) };
  }

  if (!digits) {
    return { prefix: DEFAULT_PHONE_PREFIX, local: '' };
  }

  for (let len = 3; len >= 1; len -= 1) {
    const cc = digits.slice(0, len);
    const local = digits.slice(len);
    if (!COUNTRY_CALLING_CODES.has(cc)) continue;
    if (local.length < 6 || local.length > 12) continue;
    return { prefix: cc, local: local.slice(0, 20) };
  }

  if (
    digits.startsWith(DEFAULT_PHONE_PREFIX) &&
    digits.length > DEFAULT_PHONE_PREFIX.length
  ) {
    return {
      prefix: DEFAULT_PHONE_PREFIX,
      local: digits.slice(DEFAULT_PHONE_PREFIX.length, DEFAULT_PHONE_PREFIX.length + 20),
    };
  }

  return { prefix: DEFAULT_PHONE_PREFIX, local: digits.slice(0, 20) };
}

function registerInboxViews(app, ctx) {
  const { query, config, loadSegments, loadSyncedTemplates, resolveAppBaseUrl, appPath } = ctx;
  const { loadContactAttributes } = require('../services/contactAttributes');

  function contactFiltersFromQuery(req) {
    return {
      contactSegmentFilter: String(req.query.segment || '').trim(),
      contactSearchQ: String(req.query.q || '').trim(),
      showReplaced: String(req.query.show_replaced || '').trim() === '1',
      contactAttrKey: String(req.query.attr_key || '').trim(),
      contactAttrValue: String(req.query.attr_value || '').trim(),
    };
  }

  async function loadContactsList(
    area,
    segmentsList,
    segmentFilterRaw,
    searchQRaw,
    showReplacedRaw,
    attrKeyRaw = '',
    attrValueRaw = ''
  ) {
    const slugSet = new Set(segmentsList.map((s) => s.value));
    const rawSeg = String(segmentFilterRaw || '').trim();
    const seg = rawSeg && slugSet.has(rawSeg) ? rawSeg : '';
    const showReplaced = String(showReplacedRaw || '').trim() === '1';
    const params = [area];
    let wh = 'WHERE c.area = $1';
    let p = 2;
    if (!showReplaced) {
      wh += ' AND c.replacement_reason IS NULL AND c.replaced_by_contact_id IS NULL';
    }
    if (seg) {
      wh += ` AND EXISTS (SELECT 1 FROM contact_segments csf WHERE csf.contact_id = c.id AND csf.segment_slug = $${p})`;
      params.push(seg);
      p += 1;
    }
    const searchQ = String(searchQRaw || '').trim();
    const qDigits = searchQ.replace(/\D/g, '');
    if (searchQ) {
      const searchPat = `%${escapeForLikePattern(searchQ)}%`;
      wh += ` AND (COALESCE(c.name, '') ILIKE $${p} ESCAPE '!' OR COALESCE(c.phone, '') ILIKE $${p} ESCAPE '!'`;
      params.push(searchPat);
      p += 1;
      if (qDigits) {
        wh += ` OR regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g') LIKE $${p}`;
        params.push(`%${qDigits}%`);
        p += 1;
      }
      wh += ')';
    }
    const ak = String(attrKeyRaw || '').trim().toLowerCase();
    const av = String(attrValueRaw || '').trim();
    if (ak && av) {
      wh += ` AND EXISTS (
        SELECT 1 FROM contact_attributes ca
        WHERE ca.contact_id = c.id AND ca.attr_key = $${p} AND ca.attr_value ILIKE $${p + 1} ESCAPE '!'
      )`;
      params.push(ak, `%${escapeForLikePattern(av)}%`);
      p += 2;
    }
    const r = await query(
      `SELECT
         c.id,
         c.name,
         c.phone,
         c.opt_in,
         c.active,
         c.replaced_by_contact_id,
         c.replaced_at,
         c.replacement_reason,
         c.created_at,
         COALESCE((
           SELECT array_agg(cs.segment_slug ORDER BY sd.sort_order NULLS LAST, cs.segment_slug)
           FROM contact_segments cs
           JOIN segment_definitions sd ON sd.area = cs.area AND sd.slug = cs.segment_slug
           WHERE cs.contact_id = c.id
         ), ARRAY[]::varchar[]) AS segment_slugs
       FROM contacts c
       ${wh}
       ORDER BY c.id DESC
       LIMIT 400`,
      params
    );
    return r.rows;
  }

  function contactListQueryString(segmentFilter, searchQ, showReplaced, attrKey, attrValue) {
    const sp = new URLSearchParams();
    if (segmentFilter) sp.set('segment', segmentFilter);
    if (searchQ) sp.set('q', searchQ);
    if (showReplaced) sp.set('show_replaced', '1');
    if (attrKey) sp.set('attr_key', attrKey);
    if (attrValue) sp.set('attr_value', attrValue);
    const s = sp.toString();
    return s ? `?${s}` : '';
  }

  async function loadCampaignsRecent(area, limit = 200) {
    const r = await query(
      `SELECT
        c.id,
        c.segment,
        c.campaign_payload,
        c.template_name,
        c.message_text,
        c.image_url,
        c.status,
        c.total_recipients,
        c.created_at,
        c.scheduled_at,
        MIN(cl.created_at) AS first_send_at,
        COALESCE(COUNT(cl.id), 0)::int AS log_count,
        COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ${SALIDA_OK_IN} THEN 1 ELSE 0 END), 0)::int AS salida_ok,
        COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ('delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS delivered_count,
        COALESCE(SUM(CASE WHEN ${LOG_STATUS} = 'read' THEN 1 ELSE 0 END), 0)::int AS read_count,
        COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ${ERROR_IN} THEN 1 ELSE 0 END), 0)::int AS failed_count
       FROM campaigns c
       LEFT JOIN campaign_logs cl ON cl.campaign_id = c.id
       WHERE c.area = $1
       GROUP BY c.id
       ORDER BY c.id DESC
       LIMIT $2`,
      [area, limit]
    );
    return r.rows;
  }

  async function loadCampaignTotals(area) {
    const r = await query(
      `SELECT
         COUNT(cl.id)::int AS total_logs,
         COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ${SALIDA_OK_IN} THEN 1 ELSE 0 END), 0)::int AS salida_ok,
         COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ('delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS delivered_count,
         COALESCE(SUM(CASE WHEN ${LOG_STATUS} = 'read' THEN 1 ELSE 0 END), 0)::int AS read_count,
         COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ${ERROR_IN} THEN 1 ELSE 0 END), 0)::int AS failed_count
       FROM campaigns c
       LEFT JOIN campaign_logs cl ON cl.campaign_id = c.id
       WHERE c.area = $1`,
      [area]
    );
    return r.rows[0] || {
      total_logs: 0,
      salida_ok: 0,
      delivered_count: 0,
      read_count: 0,
      failed_count: 0,
    };
  }

  async function loadCampaignDetail(area, campaignId) {
    const [campaignResult, logsResult, failedLogs, responderMetrics, retryStats] = await Promise.all([
      query(`SELECT * FROM campaigns WHERE id = $1 AND area = $2`, [campaignId, area]),
      query(
        `SELECT id, phone, whatsapp_message_id, status, response, created_at, attempt, retryable, last_retry_at
         FROM campaign_logs
         WHERE campaign_id = $1
         ORDER BY id DESC`,
        [campaignId]
      ),
      fetchCampaignFailedLogs(query, campaignId),
      fetchCampaignResponderMetrics(query, campaignId, area),
      fetchCampaignRetryStats(query, campaignId),
    ]);
    if (campaignResult.rowCount === 0) return null;
    return {
      campaign: campaignResult.rows[0],
      logs: logsResult.rows,
      failedLogs,
      responderMetrics,
      retryStats,
    };
  }

  function commonLocals(req, res) {
    return {
      basePath: config.basePath,
      appBaseUrl: resolveAppBaseUrl(),
      requireAuth: config.requireAuth,
      currentUser: req.user,
      areaLabel: res.locals.areaLabel,
      showAdminNav: res.locals.showAdminNav,
    };
  }

  /* --- Campañas (envío) --- */
  app.get('/campaigns/new', async (req, res) => {
    const area = req.user.area;
    const [segmentsList, campaigns, syncedTemplates] = await Promise.all([
      loadSegments(area),
      loadCampaignsRecent(area, 200),
      loadSyncedTemplates(area),
    ]);
    res.render('campaigns-new', {
      ...commonLocals(req, res),
      activeNav: 'campaigns',
      pageTitle: 'Nueva campaña · MALI WhatsApp',
      layoutModifier: '',
      segments: segmentsList,
      campaigns,
      syncedTemplates,
      templatesSynced: String(req.query.templates_synced || '') === '1',
      templatesSyncError: req.query.templates_sync_err || null,
      extraHeadScripts: [`${config.basePath || ''}/js/campaign-template.js`],
    });
  });

  app.get('/campaigns/:id', async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).send('Id de campana invalido');
    }
    const area = req.user.area;
    const detail = await loadCampaignDetail(area, campaignId);
    if (!detail) {
      return res.status(404).send('Campaña no encontrada');
    }
    const campaigns = await loadCampaignsRecent(area, 200);
    res.render('campaign-detail', {
      ...commonLocals(req, res),
      activeNav: 'campaigns',
      pageTitle: `Campaña #${campaignId} · MALI WhatsApp`,
      layoutModifier: 'conversations-inbox--detail',
      campaign: detail.campaign,
      logs: detail.logs,
      failedLogs: detail.failedLogs,
      responderMetrics: detail.responderMetrics,
      retryStats: detail.retryStats,
      campaigns,
      listBasePath: '/campaigns',
      sidebarTitle: 'Campañas',
      showNewLink: true,
      selectedCampaignId: campaignId,
    });
  });

  app.get('/campaigns', async (req, res) => {
    const area = req.user.area;
    const [campaigns, campaignTotals] = await Promise.all([loadCampaignsRecent(area, 200), loadCampaignTotals(area)]);
    res.render('campaigns-index', {
      ...commonLocals(req, res),
      activeNav: 'campaigns',
      pageTitle: 'Campañas · MALI WhatsApp',
      layoutModifier: '',
      campaigns,
      campaignTotals,
      templatesSynced: String(req.query.templates_synced || '') === '1',
    });
  });

  /* Redirecciones antiguas (historial unificado en Campañas) */
  app.get('/history', (req, res) => {
    res.redirect(302, appPath('/campaigns'));
  });
  app.get('/history/:id', (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.redirect(302, appPath('/campaigns'));
    }
    res.redirect(302, appPath(`/campaigns/${campaignId}`));
  });

  /* --- Contactos --- */
  app.get('/contacts/new', async (req, res) => {
    const area = req.user.area;
    const {
      contactSegmentFilter,
      contactSearchQ,
      showReplaced,
      contactAttrKey,
      contactAttrValue,
    } = contactFiltersFromQuery(req);
    const prefillName = String(req.query.prefill_name || '').trim().slice(0, 150);
    const prefillPhone = String(req.query.prefill_phone || '').replace(/\D/g, '');
    const prefillPrefixRaw = String(req.query.prefill_prefix || '').replace(/\D/g, '');
    const prefillLocalRaw = String(req.query.prefill_local || '').replace(/\D/g, '');
    const inferred = inferPrefillPhoneParts(prefillPhone, prefillPrefixRaw, prefillLocalRaw);
    const prefillPhonePrefix = inferred.prefix;
    const prefillPhoneLocal = inferred.local;
    const segmentsList = await loadSegments(area);
    const contactsRows = await loadContactsList(
      area,
      segmentsList,
      contactSegmentFilter,
      contactSearchQ,
      showReplaced,
      contactAttrKey,
      contactAttrValue
    );
    res.render('contacts-page', {
      ...commonLocals(req, res),
      activeNav: 'contacts',
      pageTitle: 'Nuevo contacto · MALI WhatsApp',
      layoutModifier: '',
      segments: segmentsList,
      contacts: contactsRows,
      contactSegmentFilter,
      contactSearchQ,
      showReplaced,
      contactAttrKey,
      contactAttrValue,
      contactListQuery: contactListQueryString(
        contactSegmentFilter,
        contactSearchQ,
        showReplaced,
        contactAttrKey,
        contactAttrValue
      ),
      view: 'new',
      selectedContactId: null,
      contact: null,
      prefillName,
      prefillPhonePrefix,
      prefillPhoneLocal,
      csvImport: null,
      maxCsvRows: config.MAX_CSV_ROWS,
      contactUpdated: String(req.query.contact_updated || '') === '1',
      contactDeleted: String(req.query.contact_deleted || '') === '1',
    });
  });

  app.get('/contacts/import', async (req, res) => {
    const area = req.user.area;
    const {
      contactSegmentFilter,
      contactSearchQ,
      showReplaced,
      contactAttrKey,
      contactAttrValue,
    } = contactFiltersFromQuery(req);
    const segmentsList = await loadSegments(area);
    const contactsRows = await loadContactsList(
      area,
      segmentsList,
      contactSegmentFilter,
      contactSearchQ,
      showReplaced,
      contactAttrKey,
      contactAttrValue
    );
    res.render('contacts-page', {
      ...commonLocals(req, res),
      activeNav: 'contacts',
      pageTitle: 'Importar Excel · MALI WhatsApp',
      layoutModifier: '',
      segments: segmentsList,
      contacts: contactsRows,
      contactSegmentFilter,
      contactSearchQ,
      showReplaced,
      contactAttrKey,
      contactAttrValue,
      contactListQuery: contactListQueryString(
        contactSegmentFilter,
        contactSearchQ,
        showReplaced,
        contactAttrKey,
        contactAttrValue
      ),
      view: 'import',
      selectedContactId: null,
      contact: null,
      csvImport:
        String(req.query.contacts_import || '') === '1'
          ? {
              ok: req.query.ok !== undefined ? Number(req.query.ok) : null,
              bad: req.query.bad !== undefined ? Number(req.query.bad) : null,
              dup: req.query.dup !== undefined ? Number(req.query.dup) : 0,
              dupRows: req.query.dup_rows !== undefined ? Number(req.query.dup_rows) : 0,
              dupExamples: String(req.query.dup_examples || '')
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean)
                .slice(0, 3),
              err: req.query.err || null,
            }
          : null,
      maxCsvRows: config.MAX_CSV_ROWS,
      contactUpdated: false,
      contactDeleted: false,
    });
  });

  app.get('/contacts/:id', async (req, res) => {
    const contactId = Number(req.params.id);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      return res.status(400).send('Id de contacto invalido');
    }
    const area = req.user.area;
    const {
      contactSegmentFilter,
      contactSearchQ,
      showReplaced,
      contactAttrKey,
      contactAttrValue,
    } = contactFiltersFromQuery(req);
    const segmentsList = await loadSegments(area);
    const [contactsRows, one, contactAttributes] = await Promise.all([
      loadContactsList(
        area,
        segmentsList,
        contactSegmentFilter,
        contactSearchQ,
        showReplaced,
        contactAttrKey,
        contactAttrValue
      ),
      query(
        `SELECT
           c.id,
           c.name,
           c.phone,
           c.opt_in,
           c.active,
           c.replaced_by_contact_id,
           c.replaced_at,
           c.replacement_reason,
           c.created_at,
           COALESCE((
             SELECT array_agg(cs.segment_slug ORDER BY sd.sort_order NULLS LAST, cs.segment_slug)
             FROM contact_segments cs
             JOIN segment_definitions sd ON sd.area = cs.area AND sd.slug = cs.segment_slug
             WHERE cs.contact_id = c.id
           ), ARRAY[]::varchar[]) AS segment_slugs
         FROM contacts c
         WHERE c.id = $1 AND c.area = $2`,
        [contactId, area]
      ),
      loadContactAttributes(query, contactId),
    ]);
    if (one.rowCount === 0) {
      return res.status(404).send('Contacto no encontrado');
    }
    res.render('contacts-page', {
      ...commonLocals(req, res),
      activeNav: 'contacts',
      pageTitle: `${one.rows[0].name || one.rows[0].phone} · Contactos · MALI WhatsApp`,
      layoutModifier: 'conversations-inbox--detail',
      segments: segmentsList,
      contacts: contactsRows,
      contactSegmentFilter,
      contactSearchQ,
      showReplaced,
      contactAttrKey,
      contactAttrValue,
      contactListQuery: contactListQueryString(
        contactSegmentFilter,
        contactSearchQ,
        showReplaced,
        contactAttrKey,
        contactAttrValue
      ),
      view: 'edit',
      selectedContactId: contactId,
      contact: one.rows[0],
      contactAttributes: contactAttributes || {},
      csvImport: null,
      maxCsvRows: config.MAX_CSV_ROWS,
      contactUpdated: String(req.query.contact_updated || '') === '1',
      contactDeleted: String(req.query.contact_deleted || '') === '1',
    });
  });

  app.get('/contacts', async (req, res) => {
    const area = req.user.area;
    const {
      contactSegmentFilter,
      contactSearchQ,
      showReplaced,
      contactAttrKey,
      contactAttrValue,
    } = contactFiltersFromQuery(req);
    const segmentsList = await loadSegments(area);
    const contactsRows = await loadContactsList(
      area,
      segmentsList,
      contactSegmentFilter,
      contactSearchQ,
      showReplaced,
      contactAttrKey,
      contactAttrValue
    );
    res.render('contacts-page', {
      ...commonLocals(req, res),
      activeNav: 'contacts',
      pageTitle: 'Contactos · MALI WhatsApp',
      layoutModifier: '',
      segments: segmentsList,
      contacts: contactsRows,
      contactSegmentFilter,
      contactSearchQ,
      showReplaced,
      contactAttrKey,
      contactAttrValue,
      contactListQuery: contactListQueryString(
        contactSegmentFilter,
        contactSearchQ,
        showReplaced,
        contactAttrKey,
        contactAttrValue
      ),
      view: 'list',
      selectedContactId: null,
      contact: null,
      csvImport:
        String(req.query.contacts_import || '') === '1'
          ? {
              ok: req.query.ok !== undefined ? Number(req.query.ok) : null,
              bad: req.query.bad !== undefined ? Number(req.query.bad) : null,
              dup: req.query.dup !== undefined ? Number(req.query.dup) : 0,
              dupRows: req.query.dup_rows !== undefined ? Number(req.query.dup_rows) : 0,
              dupExamples: String(req.query.dup_examples || '')
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean)
                .slice(0, 3),
              err: req.query.err || null,
            }
          : null,
      maxCsvRows: config.MAX_CSV_ROWS,
      contactUpdated: String(req.query.contact_updated || '') === '1',
      contactDeleted: String(req.query.contact_deleted || '') === '1',
    });
  });

  /* --- Segmentos --- */
  app.get('/segments/new', async (req, res) => {
    const area = req.user.area;
    const segmentsList = await loadSegments(area);
    res.render('segments-page', {
      ...commonLocals(req, res),
      activeNav: 'segments',
      pageTitle: 'Añadir segmento · MALI WhatsApp',
      layoutModifier: '',
      segments: segmentsList,
      view: 'new',
      selectedSegmentId: null,
      selectedSegment: null,
      segmentsSaved: String(req.query.segments_saved || '') === '1',
    });
  });

  app.get('/segments/:id', async (req, res) => {
    const segId = Number(req.params.id);
    if (!Number.isInteger(segId) || segId <= 0) {
      return res.status(400).send('Id de segmento invalido');
    }
    const area = req.user.area;
    const segmentsList = await loadSegments(area);
    const sel = segmentsList.find((s) => s.id === segId);
    if (!sel) {
      return res.status(404).send('Segmento no encontrado');
    }
    res.render('segments-page', {
      ...commonLocals(req, res),
      activeNav: 'segments',
      pageTitle: `${sel.label} · Segmentos · MALI WhatsApp`,
      layoutModifier: 'conversations-inbox--detail',
      segments: segmentsList,
      view: 'detail',
      selectedSegmentId: segId,
      selectedSegment: sel,
      segmentsSaved: String(req.query.segments_saved || '') === '1',
    });
  });

  app.get('/segments', async (req, res) => {
    const area = req.user.area;
    const segmentsList = await loadSegments(area);
    res.render('segments-page', {
      ...commonLocals(req, res),
      activeNav: 'segments',
      pageTitle: 'Segmentos · MALI WhatsApp',
      layoutModifier: '',
      segments: segmentsList,
      view: 'list',
      selectedSegmentId: null,
      selectedSegment: null,
      segmentsSaved: String(req.query.segments_saved || '') === '1',
    });
  });

  /* --- Ajustes --- */
  app.get('/settings', async (req, res) => {
    let aiAreaEnabled = false;
    let aiPrompt = '';
    let aiTransferKeyword = '[TRANSFERIR]';
    const u = req.user;
    const settingsShowAiMaster = Boolean(u && u.isMaster);
    const settingsShowAiPromptEditor = Boolean(
      u && (u.isMaster || u.canEditAiPrompt)
    );
    if (u && settingsShowAiPromptEditor) {
      const r = await query(`SELECT value FROM app_settings WHERE area = $1 AND key = 'ai_config'`, [
        u.area,
      ]);
      const cfg = parseAiConfigValue(r.rows[0]?.value);
      aiAreaEnabled = Boolean(cfg && cfg.enabled);
      if (cfg) {
        aiPrompt = cfg.prompt || '';
        aiTransferKeyword = cfg.transfer_keyword || '[TRANSFERIR]';
      }
    }
    res.render('settings-page', {
      ...commonLocals(req, res),
      activeNav: 'settings',
      pageTitle: 'Ajustes · MALI WhatsApp',
      layoutModifier: '',
      aiAreaEnabled,
      masterArea: u && u.area ? u.area : '',
      aiPrompt,
      aiTransferKeyword,
      settingsShowAiMaster,
      settingsShowAiPromptEditor,
    });
  });
}

module.exports = { registerInboxViews };
