/**
 * Contexto compartido para routers (MALI WhatsApp).
 * Jerarquía de negocio prevista: museo → áreas → usuarios por área → segmentos → clientes.
 * Áreas en BD: ti | pam | educacion (CHECK en migraciones).
 */
const config = require('../../config');
const { normalizeArea } = require('../../middleware/auth');
const {
  buildTemplateDefinition,
  extractFormValuesForTemplate,
  validateTemplateFormValues,
} = require('../../services/templateParser');
const { isWithinUserServiceWindow } = require('../../utils/conversations');
const { escapeForLikePattern } = require('../../utils/searchEscape');
const { normalizeSegmentColorKey } = require('../../utils/segmentColors');

function resolveAppBaseUrl() {
  const u = String(process.env.APP_BASE_URL || '').trim().replace(/\/$/, '');
  if (u) return u;
  return `http://localhost:${config.port}${config.basePath}`;
}

function createRouteContext({ query, pool, appPath }) {
  async function getSegmentSlugSet(area) {
    const r = await query(`SELECT slug FROM segment_definitions WHERE area = $1`, [normalizeArea(area)]);
    return new Set(r.rows.map((x) => x.slug));
  }

  async function loadSegments(area) {
    const r = await query(
      `SELECT id, slug, label, sort_order, color_key FROM segment_definitions WHERE area = $1 ORDER BY sort_order ASC, slug ASC`,
      [normalizeArea(area)]
    );
    return r.rows.map((row) => ({
      id: row.id,
      value: row.slug,
      label: row.label,
      sort_order: row.sort_order,
      colorKey: normalizeSegmentColorKey(row.color_key),
    }));
  }

  function parseInboxSegmentFilter(reqQuery, slugSet) {
    const raw = String(reqQuery.segment ?? '').trim();
    if (!raw) return '';
    if (raw === '__none__') return '__none__';
    if (slugSet.has(raw)) return raw;
    return '';
  }

  function parseInboxSearchQ(reqQuery) {
    return String(reqQuery.q ?? '').trim();
  }

  /** Filtro de lista tipo WhatsApp: todos los chats o solo no leídos (panel). */
  function parseInboxChatFilter(reqQuery) {
    const raw = String(reqQuery.chat ?? '').trim();
    return raw === 'unread' ? 'unread' : 'all';
  }

  function inboxQueryString(segmentFilter, searchQ, chatFilter) {
    const sp = new URLSearchParams();
    if (segmentFilter) sp.set('segment', segmentFilter);
    if (searchQ) sp.set('q', searchQ);
    if (chatFilter === 'unread') sp.set('chat', 'unread');
    const s = sp.toString();
    return s ? `?${s}` : '';
  }

  async function fetchInboxConversations(area, segmentFilter, searchQText, chatFilter) {
    const params = [area];
    let p = 2;
    let extra = '';
    if (segmentFilter === '__none__') {
      extra += ` AND c.contact_id IS NULL`;
    } else if (segmentFilter) {
      extra += ` AND ct.segment = $${p}`;
      params.push(segmentFilter);
      p += 1;
    }
    if (searchQText) {
      const pat = `%${escapeForLikePattern(searchQText)}%`;
      extra += ` AND EXISTS (
        SELECT 1 FROM chat_messages m
        WHERE m.conversation_id = c.id
        AND m.body_text ILIKE $${p} ESCAPE '!'
      )`;
      params.push(pat);
      p += 1;
    }
    if (chatFilter === 'unread') {
      extra += ` AND c.inbox_unread = TRUE`;
    }
    const listResult = await query(
      `SELECT
          c.id,
          c.phone,
          c.last_message_at,
          c.last_user_message_at,
          c.inbox_unread,
          ct.lead_score AS contact_lead_score,
          ct.name AS contact_name,
          ct.segment AS contact_segment,
          (SELECT m.body_text FROM chat_messages m
           WHERE m.conversation_id = c.id
           ORDER BY m.created_at DESC
           LIMIT 1) AS preview
        FROM conversations c
        LEFT JOIN contacts ct ON ct.id = c.contact_id
        WHERE c.area = $1
        ${extra}
        ORDER BY c.last_message_at DESC
        LIMIT 200`,
      params
    );
    return listResult.rows;
  }

  async function loadSyncedTemplates(area) {
    const r = await query(
      `SELECT id, name, language, category, status, components_json, synced_at
       FROM whatsapp_templates
       WHERE area = $1 AND UPPER(status) = 'APPROVED'
       ORDER BY name ASC, language ASC`,
      [normalizeArea(area)]
    );
    return r.rows;
  }

  function validateCampaignWithSync(reqBody, segmentSet, templateRow) {
    const segment = String(reqBody.segment || '').trim();
    const batchSize = Number(reqBody.batchSize || process.env.DEFAULT_BATCH_SIZE || 40);
    const batchDelayMs = Number(reqBody.batchDelayMs || process.env.DEFAULT_BATCH_DELAY_MS || 1500);

    if (!segmentSet.has(segment)) {
      return { ok: false, message: 'Segmento invalido' };
    }
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > config.MAX_BATCH_SIZE) {
      return { ok: false, message: `Batch size invalido (1-${config.MAX_BATCH_SIZE})` };
    }
    if (!Number.isInteger(batchDelayMs) || batchDelayMs < 0 || batchDelayMs > config.MAX_BATCH_DELAY_MS) {
      return { ok: false, message: `Batch delay invalido (0-${config.MAX_BATCH_DELAY_MS})` };
    }

    const templateSyncId = parseInt(String(reqBody.templateSyncId || '').trim(), 10);
    if (!Number.isInteger(templateSyncId) || templateSyncId <= 0) {
      return { ok: false, message: 'Selecciona una plantilla sincronizada' };
    }
    if (!templateRow) {
      return { ok: false, message: 'Plantilla no encontrada. Sincroniza desde Meta.' };
    }

    const def = buildTemplateDefinition(templateRow);
    const values = extractFormValuesForTemplate(def, reqBody);

    if (def.needsHeaderMedia && values.headerMediaUrl.length > config.MAX_IMAGE_URL_LEN) {
      return { ok: false, message: `URL demasiado larga (max ${config.MAX_IMAGE_URL_LEN})` };
    }

    const v = validateTemplateFormValues(def, values, {
      maxBodyLen: config.MAX_BODY_PARAM_LEN,
      maxUrlLen: config.MAX_IMAGE_URL_LEN,
    });
    if (!v.ok) return v;

    const messageText = [
      def.needsHeaderMedia ? `media:${values.headerMediaUrl}` : '',
      ...values.headerParams,
      ...values.bodyParams,
      ...values.buttonParams,
    ]
      .filter(Boolean)
      .join(' | ');

    const scheduleMode = String(reqBody.scheduleMode || 'now').trim().toLowerCase();
    const isScheduled = scheduleMode === 'scheduled';
    let scheduledAt = null;

    if (isScheduled) {
      const raw = String(reqBody.scheduledAt || '').trim();
      if (!raw) {
        return { ok: false, message: 'Indica fecha y hora para la campaña programada' };
      }
      const t = new Date(raw);
      if (Number.isNaN(t.getTime())) {
        return { ok: false, message: 'Fecha u hora de programación no válida' };
      }
      const minT = Date.now() + config.CAMPAIGN_SCHEDULE_MIN_MARGIN_MS;
      if (t.getTime() < minT) {
        return {
          ok: false,
          message: 'La programación debe ser al menos 1 minuto en el futuro',
        };
      }
      const maxMs = config.CAMPAIGN_SCHEDULE_MAX_DAYS * 24 * 60 * 60 * 1000;
      if (t.getTime() > Date.now() + maxMs) {
        return {
          ok: false,
          message: `La programación no puede superar ${config.CAMPAIGN_SCHEDULE_MAX_DAYS} días`,
        };
      }
      scheduledAt = t;
    }

    return {
      ok: true,
      value: {
        segment,
        templateSyncId,
        templateRow,
        def,
        values,
        messageText: messageText || '(sin parametros variables)',
        imageUrl: def.needsHeaderMedia ? values.headerMediaUrl : null,
        batchSize,
        batchDelayMs,
        isScheduled,
        scheduledAt,
      },
    };
  }

  async function buildInboxRenderData(req, { selectedId }) {
    const area = req.user.area;
    const slugSet = await getSegmentSlugSet(area);
    const segmentFilter = parseInboxSegmentFilter(req.query, slugSet);
    const searchQ = parseInboxSearchQ(req.query);
    const chatFilter = parseInboxChatFilter(req.query);
    const [segments, listRows] = await Promise.all([
      loadSegments(area),
      fetchInboxConversations(area, segmentFilter, searchQ, chatFilter),
    ]);
    const inboxQuery = inboxQueryString(segmentFilter, searchQ, chatFilter);
    const inboxQueryAll = inboxQueryString(segmentFilter, searchQ, 'all');
    const inboxQueryUnread = inboxQueryString(segmentFilter, searchQ, 'unread');
    let selectedConversation = null;
    let contact = null;
    let messages = [];
    let canReply = false;
    if (selectedId != null) {
      const convResult = await query(`SELECT * FROM conversations WHERE id = $1 AND area = $2`, [
        selectedId,
        area,
      ]);
      if (convResult.rowCount === 0) {
        return { notFound: true };
      }
      selectedConversation = convResult.rows[0];
      await query(
        `UPDATE conversations SET inbox_unread = FALSE, updated_at = NOW() WHERE id = $1 AND area = $2`,
        [selectedId, area]
      );
      selectedConversation.inbox_unread = false;
      const contactRow = selectedConversation.contact_id
        ? await query(`SELECT name, phone, segment, lead_score FROM contacts WHERE id = $1`, [
            selectedConversation.contact_id,
          ])
        : { rows: [] };
      contact = contactRow.rows[0] || null;
      const messagesResult = await query(
        `SELECT id, direction, body_text, message_type, created_at, wa_message_id, raw_payload
         FROM chat_messages
         WHERE conversation_id = $1
         ORDER BY created_at ASC`,
        [selectedId]
      );
      messages = messagesResult.rows;
      canReply = isWithinUserServiceWindow(selectedConversation.last_user_message_at);
    }
    let conversationsOut = listRows;
    if (selectedId != null) {
      conversationsOut = listRows.map((row) =>
        Number(row.id) === Number(selectedId) ? { ...row, inbox_unread: false } : row
      );
    }
    return {
      segments,
      segmentFilter,
      searchQ,
      chatFilter,
      inboxQuery,
      inboxQueryAll,
      inboxQueryUnread,
      conversations: conversationsOut,
      selectedConversation,
      contact,
      messages,
      canReply,
    };
  }

  return {
    query,
    pool,
    appPath,
    config,
    getSegmentSlugSet,
    loadSegments,
    loadSyncedTemplates,
    validateCampaignWithSync,
    buildInboxRenderData,
    resolveAppBaseUrl,
  };
}

module.exports = { createRouteContext, resolveAppBaseUrl };
