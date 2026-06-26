const XLSX = require('xlsx');
const { logError } = require('../utils/logger');
const { auditLog, AuditEvent } = require('../services/auditLog');
const config = require('../config');
const { normalizeArea } = require('../middleware/auth');
const datetimeDisplay = require('../utils/datetimeDisplay');
const { buildCampaignFailedLogsCsv } = require('../utils/campaignLogErrorSummary');
const { fetchCampaignFailedLogs } = require('../services/campaignFailedLogs');
const {
  fetchCampaignResponders,
  fetchCampaignInteractiveResponders,
  mergeInteractiveIntoResponders,
} = require('../services/campaignResponders');
const { campaignLimiter } = require('../middleware/limiters');
const { runCampaignSendJob } = require('../services/campaignSender');
const { runCampaignRetryJob } = require('../services/campaignRetry');
const { syncCampaignCost } = require('../services/campaignCostSync');
const {
  fetchRecipientsUnion,
  countRecipientsUnion,
  validateRecipientsMatchRequest,
} = require('../services/campaignRecipients');
const { isWithinUserServiceWindow } = require('../utils/conversations');
const {
  sqlCampaignLogContactJoin,
  sqlCampaignLogContactName,
  sqlCampaignLogSegmentLabels,
  exportContactName,
  exportSegmentLabels,
} = require('../utils/campaignExportContactMeta');

function stringifyExportDetail(response) {
  if (response == null || response === '') return '';
  if (typeof response === 'string') return response;
  try {
    return JSON.stringify(response);
  } catch {
    return String(response);
  }
}

function normalizeCampaignLogStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function collectLatestCampaignLogsByPhone(logs) {
  const latestLogs = [];
  const seenPhones = new Set();
  for (const log of Array.isArray(logs) ? logs : []) {
    const phone = String(log?.phone || '').trim();
    const key = phone || `log:${String(log?.id || '')}`;
    if (seenPhones.has(key)) continue;
    seenPhones.add(key);
    latestLogs.push(log);
  }
  return latestLogs;
}

function filterCampaignCurrentLogs(logs, filter) {
  const latestLogs = collectLatestCampaignLogsByPhone(logs);
  const key = String(filter || 'all_current').trim().toLowerCase();
  if (!key || key === 'all_current') return latestLogs;
  return latestLogs.filter((log) => {
    const status = normalizeCampaignLogStatus(log.status);
    if (key === 'sent_all') return status === 'sent' || status === 'delivered' || status === 'read';
    if (key === 'delivered_all') return status === 'delivered' || status === 'read';
    if (key === 'read_only') return status === 'read';
    if (key === 'sent_only') return status === 'sent';
    if (key === 'delivered_only') return status === 'delivered';
    return true;
  });
}

function filterCampaignFailedLogs(logs, filter) {
  const key = String(filter || 'all').trim().toLowerCase();
  if (!key || key === 'all') return Array.isArray(logs) ? logs : [];
  return (Array.isArray(logs) ? logs : []).filter((log) => {
    const type = String(log?.incident_type || '').trim().toLowerCase();
    return type === key;
  });
}

function buildCampaignLogsExportBuffer(logs, formatDate) {
  const aoa = [
    ['Fecha y hora', 'Teléfono', 'Nombre', 'Segmentos', 'Estado', 'ID mensaje', 'Detalle'],
    ...logs.map((log) => [
      formatDate(log.created_at),
      String(log.phone || ''),
      exportContactName(log),
      exportSegmentLabels(log),
      String(log.status || ''),
      String(log.whatsapp_message_id || ''),
      stringifyExportDetail(log.response),
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 28 }, { wch: 36 }, { wch: 14 }, { wch: 28 }, { wch: 90 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Registro de envíos');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function buildCampaignFailedLogsExportBuffer(logs, formatDate) {
  const aoa = [
    ['Fecha y hora', 'Teléfono', 'Nombre', 'Segmentos', 'Estado', 'Incidencia', 'Motivo'],
    ...(Array.isArray(logs) ? logs : []).map((log) => [
      formatDate(log.created_at),
      String(log.phone || ''),
      exportContactName(log),
      exportSegmentLabels(log),
      String(log.status || ''),
      String(log.incident_label || ''),
      String(log.error_summary || ''),
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 28 }, { wch: 36 }, { wch: 14 }, { wch: 24 }, { wch: 80 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Incidencias');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function buildCampaignRespondersExportBuffer(rows, formatDate) {
  const aoa = [
    ['Teléfono', 'Nombre', 'Segmentos', 'Primera respuesta', 'Respuesta interactiva'],
    ...(Array.isArray(rows) ? rows : []).map((row) => [
      String(row.phone || ''),
      String(row.contactName || ''),
      String(row.segmentLabels || ''),
      formatDate(row.firstResponseAt),
      String(row.interactiveResponseText || ''),
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 18 }, { wch: 28 }, { wch: 36 }, { wch: 24 }, { wch: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Respuestas');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function registerCampaigns(app, ctx) {
  const { query, getSegmentSlugSet, validateCampaignWithSync, appPath } = ctx;

  /**
   * Vista previa: unión de contactos por segmentos (sin filtrar por IDs).
   */
  app.post('/api/campaigns/recipients-preview', campaignLimiter, async (req, res) => {
    const area = normalizeArea(req.user.area);
    try {
      const raw = req.body?.segments;
      if (!Array.isArray(raw) || raw.length === 0) {
        return res.status(400).json({ ok: false, error: 'Indica al menos un segmento' });
      }
      const segmentSet = await getSegmentSlugSet(area);
      const segments = [...new Set(raw.map((s) => String(s).trim()).filter(Boolean))];
      if (segments.length === 0) {
        return res.status(400).json({ ok: false, error: 'Indica al menos un segmento' });
      }
      for (const s of segments) {
        if (!segmentSet.has(s)) {
          return res.status(400).json({ ok: false, error: 'Segmento inválido' });
        }
      }

      const recipientOptions = {};
      if (Array.isArray(req.body?.excludeSegmentSlugs)) {
        const excludeSlugs = [...new Set(req.body.excludeSegmentSlugs.map((s) => String(s).trim()).filter(Boolean))];
        for (const s of excludeSlugs) {
          if (!segmentSet.has(s)) {
            return res.status(400).json({ ok: false, error: 'Segmento de exclusión inválido' });
          }
        }
        if (excludeSlugs.length > 0) recipientOptions.excludeSegmentSlugs = excludeSlugs;
      }
      const excludeIds = Array.isArray(req.body?.excludeContactIds)
        ? [
            ...new Set(
              req.body.excludeContactIds.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0)
            ),
          ].sort((a, b) => a - b)
        : [];
      if (excludeIds.length > config.CAMPAIGN_MAX_RECIPIENT_IDS) {
        return res.status(400).json({
          ok: false,
          error: `Demasiados contactos a excluir (máximo ${config.CAMPAIGN_MAX_RECIPIENT_IDS})`,
        });
      }
      if (excludeIds.length > 0) recipientOptions.excludeContactIds = excludeIds;

      const excludeOpenServiceWindow = req.body?.excludeOpenServiceWindow === true;
      if (excludeOpenServiceWindow) recipientOptions.excludeOpenServiceWindow = true;

      const maxN = config.CAMPAIGN_RECIPIENTS_PREVIEW_MAX;
      const total = await countRecipientsUnion(query, area, segments, recipientOptions);
      if (total > maxN) {
        return res.status(400).json({
          ok: false,
          error: `Hay demasiados contactos (${total}). Máximo ${maxN}; reduce los segmentos.`,
          total,
          max: maxN,
        });
      }

      const contacts = await fetchRecipientsUnion(query, area, segments, recipientOptions);
      const mapped = contacts.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        serviceWindowOpen: isWithinUserServiceWindow(c.last_user_message_at),
      }));
      return res.json({ ok: true, contacts: mapped, total: mapped.length, excludeOpenServiceWindow });
    } catch (error) {
      logError(req, 'Error vista previa campaña', error);
      return res.status(500).json({ ok: false, error: 'No se pudo cargar la lista' });
    }
  });

  app.post('/campaigns/send', campaignLimiter, async (req, res) => {
    const wantsJson = String(req.headers.accept || '').includes('application/json');
    const jsonErr = (msg) => {
      if (wantsJson) return res.status(400).json({ ok: false, error: msg });
      return res.status(400).send(msg);
    };

    const area = normalizeArea(req.user.area);
    const segmentSet = await getSegmentSlugSet(area);
    const templateSyncId = parseInt(String(req.body.templateSyncId || '').trim(), 10);
    let templateRow = null;
    if (Number.isInteger(templateSyncId) && templateSyncId > 0) {
      const tr = await query(
        `SELECT id, name, language, category, status, components_json FROM whatsapp_templates WHERE id = $1 AND area = $2`,
        [templateSyncId, area]
      );
      if (tr.rowCount > 0) templateRow = tr.rows[0];
    }
    const validation = validateCampaignWithSync(req.body, segmentSet, templateRow);
    if (!validation.ok) {
      return jsonErr(validation.message);
    }

    const {
      segment,
      segments,
      recipientContactIds,
      excludeContactIds,
      excludeSegmentSlugs,
      excludeOpenServiceWindow,
      audienceMode,
      templateRow: tRow,
      values,
      messageText,
      imageUrl,
      batchSize,
      batchDelayMs,
      isScheduled,
      scheduledAt,
    } = validation.value;

    const uniqueExcludeIds = excludeContactIds || [];
    const recipientOptions = {};
    if (uniqueExcludeIds.length > 0) {
      recipientOptions.excludeContactIds = uniqueExcludeIds;
    }
    if (excludeSegmentSlugs && excludeSegmentSlugs.length > 0) {
      recipientOptions.excludeSegmentSlugs = excludeSegmentSlugs;
    }
    if (excludeOpenServiceWindow) {
      recipientOptions.excludeOpenServiceWindow = true;
    }

    try {
      let recipients;
      if (audienceMode === 'multi' && recipientContactIds && recipientContactIds.length > 0) {
        recipients = await fetchRecipientsUnion(query, area, segments, {
          ...recipientOptions,
          contactIds: recipientContactIds,
        });
        if (!validateRecipientsMatchRequest(recipients, recipientContactIds)) {
          const msg = excludeOpenServiceWindow
            ? 'Destinatarios inválidos, fuera de los segmentos o con ventana de 24 h activa (excluidos por el filtro)'
            : 'Destinatarios inválidos o no pertenecen a los segmentos seleccionados';
          return jsonErr(msg);
        }
      } else {
        recipients = await fetchRecipientsUnion(query, area, segments, recipientOptions);
      }

      const templateSnapshot = {
        id: tRow.id,
        name: tRow.name,
        language: tRow.language,
        category: tRow.category,
        components_json: tRow.components_json,
      };

      const staticParams = {
        headerParams: values.headerParams,
        bodyParams: values.bodyParams,
        buttonParams: values.buttonParams,
        headerMediaUrl: values.headerMediaUrl,
      };

      const campaignPayload = {
        area,
        segments,
        templateSnapshot,
        staticParams,
        paramMapping: validation.value.paramMapping || null,
        batchSize,
        batchDelayMs,
      };
      if (audienceMode === 'multi' && recipientContactIds && recipientContactIds.length > 0) {
        campaignPayload.recipientContactIds = recipientContactIds;
      } else {
        campaignPayload.segment = segments[0];
      }
      if (excludeContactIds && excludeContactIds.length > 0) {
        campaignPayload.excludeContactIds = excludeContactIds;
      }
      if (excludeSegmentSlugs && excludeSegmentSlugs.length > 0) {
        campaignPayload.excludeSegmentSlugs = excludeSegmentSlugs;
      }
      if (excludeOpenServiceWindow) {
        campaignPayload.excludeOpenServiceWindow = true;
      }
      if (uniqueExcludeIds.length > 0) {
        campaignPayload.excludeContactIdsMerged = uniqueExcludeIds;
      }

      const campaignStatus = isScheduled ? 'scheduled' : 'queued';
      const campaignResult = await query(
        `INSERT INTO campaigns (area, segment, template_name, message_text, image_url, status, total_recipients, campaign_payload, scheduled_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
         RETURNING id`,
        [
          area,
          segment,
          tRow.name,
          messageText,
          imageUrl,
          campaignStatus,
          recipients.length,
          JSON.stringify(campaignPayload),
          isScheduled ? scheduledAt : null,
        ]
      );

      const campaignId = campaignResult.rows[0].id;

      if (!isScheduled) {
        setImmediate(() => runCampaignSendJob(query, { campaignId, ...campaignPayload }));
      }

      auditLog(query, {
        req,
        event_type: AuditEvent.CAMPAIGN_CREATED,
        message: isScheduled
          ? `Campaña programada #${campaignId} (${tRow.name}, ${recipients.length} destinatarios)`
          : `Campaña en cola #${campaignId} (${tRow.name}, ${recipients.length} destinatarios)`,
        meta: {
          campaign_id: campaignId,
          area,
          status: campaignStatus,
          template_name: tRow.name,
          segments,
          audience_mode: audienceMode,
          total_recipients: recipients.length,
          is_scheduled: isScheduled,
          scheduled_at: isScheduled && scheduledAt ? scheduledAt.toISOString() : null,
        },
      });

      const dest = appPath(`/campaigns/${campaignId}`);
      if (wantsJson) {
        return res.json({ ok: true, redirect: dest, campaignId });
      }
      res.redirect(dest);
    } catch (error) {
      logError(req, 'Error en envio de campana', error);
      if (wantsJson) {
        return res.status(500).json({ ok: false, error: error.message || 'Error al enviar' });
      }
      res.status(500).send(`No se pudo enviar la campaña: ${error.message}`);
    }
  });

  app.post('/api/campaigns/:id/retry-failed', campaignLimiter, async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({ ok: false, error: 'Id invalido' });
    }

    const area = normalizeArea(req.user.area);
    try {
      const campaignResult = await query(
        `SELECT id, status, manual_retry_count FROM campaigns WHERE id = $1 AND area = $2`,
        [campaignId, area]
      );
      if (campaignResult.rowCount === 0) {
        return res.status(404).json({ ok: false, error: 'Campaña no encontrada' });
      }

      const campaign = campaignResult.rows[0];
      if (campaign.status === 'processing' || campaign.status === 'queued') {
        return res.status(409).json({ ok: false, error: 'La campaña aún está en envío' });
      }
      if (Number(campaign.manual_retry_count || 0) >= config.CAMPAIGN_MAX_MANUAL_RETRIES) {
        return res.status(429).json({
          ok: false,
          error: `Límite de reintentos manuales alcanzado (${config.CAMPAIGN_MAX_MANUAL_RETRIES})`,
        });
      }

      const result = await runCampaignRetryJob(query, { campaignId, mode: 'manual' });

      auditLog(query, {
        req,
        event_type: AuditEvent.CAMPAIGN_RETRY_MANUAL,
        message: `Reintento manual campaña #${campaignId}: ${result.retried} teléfonos, ${result.recovered} recuperados`,
        meta: {
          campaign_id: campaignId,
          area,
          retried: result.retried,
          recovered: result.recovered,
          still_failed: result.stillFailed,
        },
      });

      return res.json({
        ok: true,
        retried: result.retried,
        recovered: result.recovered,
        stillFailed: result.stillFailed,
        skipped: Boolean(result.skipped),
        error: result.error || null,
      });
    } catch (error) {
      logError(req, 'Error reintento manual de campana', error);
      return res.status(500).json({ ok: false, error: 'No se pudo reintentar los envíos fallidos' });
    }
  });

  app.post('/api/campaigns/:id/sync-cost', campaignLimiter, async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({ ok: false, error: 'Id invalido' });
    }
    const area = normalizeArea(req.user.area);
    try {
      const result = await syncCampaignCost(query, { campaignId, area });
      if (!result.ok) {
        return res.status(404).json(result);
      }
      return res.json(result);
    } catch (error) {
      logError(req, 'Error sincronizando costo de campana', error);
      return res.status(500).json({ ok: false, error: 'No se pudo sincronizar el costo' });
    }
  });

  app.get('/api/campaigns/:id/failed-export', async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).send('Id invalido');
    }

    const area = normalizeArea(req.user.area);
    try {
      const campaignResult = await query(
        `SELECT id FROM campaigns WHERE id = $1 AND area = $2`,
        [campaignId, area]
      );
      if (campaignResult.rowCount === 0) {
        return res.status(404).send('Campaña no encontrada');
      }

      const failedLogs = await fetchCampaignFailedLogs(query, campaignId, area);
      const csv = buildCampaignFailedLogsCsv(failedLogs, datetimeDisplay.formatExportDate);
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="campana-${campaignId}-fallidos-${stamp}.csv"`
      );
      res.send(`\uFEFF${csv}`);
    } catch (error) {
      logError(req, 'Error exportando fallidos de campana', error);
      res.status(500).send('No se pudo exportar');
    }
  });

  app.get('/api/campaigns/:id/logs-export', async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).send('Id invalido');
    }

    const area = normalizeArea(req.user.area);
    const filter = String(req.query.filter || '').trim();
    try {
      const [campaignResult, logsResult] = await Promise.all([
        query(`SELECT id FROM campaigns WHERE id = $1 AND area = $2`, [campaignId, area]),
        query(
          `SELECT cl.id, cl.phone, cl.whatsapp_message_id, cl.status, cl.response, cl.created_at,
                  ${sqlCampaignLogContactName('$2')},
                  ${sqlCampaignLogSegmentLabels('$2')}
           FROM campaign_logs cl
           ${sqlCampaignLogContactJoin('cl', '$2')}
           WHERE cl.campaign_id = $1
           ORDER BY cl.id DESC`,
          [campaignId, area]
        ),
      ]);
      if (campaignResult.rowCount === 0) {
        return res.status(404).send('Campaña no encontrada');
      }

      const stamp = datetimeDisplay.exportFilenameDateStamp();
      const exportRows = filter ? filterCampaignCurrentLogs(logsResult.rows, filter) : logsResult.rows;
      const buffer = buildCampaignLogsExportBuffer(exportRows, datetimeDisplay.formatExportDate);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="campana-${campaignId}-registro-${stamp}.xlsx"`
      );
      return res.send(buffer);
    } catch (error) {
      logError(req, 'Error exportando registro de campana', error);
      return res.status(500).send('No se pudo exportar');
    }
  });

  app.get('/api/campaigns/:id/incidents-export', async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).send('Id invalido');
    }

    const area = normalizeArea(req.user.area);
    const filter = String(req.query.filter || '').trim();
    try {
      const campaignResult = await query(`SELECT id FROM campaigns WHERE id = $1 AND area = $2`, [campaignId, area]);
      if (campaignResult.rowCount === 0) {
        return res.status(404).send('Campaña no encontrada');
      }

      const failedLogs = await fetchCampaignFailedLogs(query, campaignId, area);
      const exportRows = filter ? filterCampaignFailedLogs(failedLogs, filter) : failedLogs;
      const stamp = datetimeDisplay.exportFilenameDateStamp();
      const buffer = buildCampaignFailedLogsExportBuffer(exportRows, datetimeDisplay.formatExportDate);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="campana-${campaignId}-incidencias-${stamp}.xlsx"`
      );
      return res.send(buffer);
    } catch (error) {
      logError(req, 'Error exportando incidencias de campana', error);
      return res.status(500).send('No se pudo exportar');
    }
  });

  app.get('/api/campaigns/:id/responders-export', async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).send('Id invalido');
    }

    const area = normalizeArea(req.user.area);
    try {
      const campaignResult = await query(`SELECT id FROM campaigns WHERE id = $1 AND area = $2`, [campaignId, area]);
      if (campaignResult.rowCount === 0) {
        return res.status(404).send('Campaña no encontrada');
      }

      const [responders, interactiveResponders] = await Promise.all([
        fetchCampaignResponders(query, campaignId, area),
        fetchCampaignInteractiveResponders(query, campaignId, area),
      ]);
      const rows = mergeInteractiveIntoResponders(responders, interactiveResponders);
      const stamp = datetimeDisplay.exportFilenameDateStamp();
      const buffer = buildCampaignRespondersExportBuffer(rows, datetimeDisplay.formatExportDate);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="campana-${campaignId}-respuestas-${stamp}.xlsx"`
      );
      return res.send(buffer);
    } catch (error) {
      logError(req, 'Error exportando respuestas de campana', error);
      return res.status(500).send('No se pudo exportar');
    }
  });

  app.get('/api/campaigns/:id', async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({ error: 'Id invalido' });
    }
    const area = normalizeArea(req.user.area);

    try {
      const [campaignResult, logsResult] = await Promise.all([
        query(`SELECT * FROM campaigns WHERE id = $1 AND area = $2`, [campaignId, area]),
        query(
          `SELECT id, phone, whatsapp_message_id, status, response, created_at
           FROM campaign_logs
           WHERE campaign_id = $1
           ORDER BY id DESC`,
          [campaignId]
        ),
      ]);

      if (campaignResult.rowCount === 0) {
        return res.status(404).json({ error: 'No encontrada' });
      }

      res.json({
        campaign: campaignResult.rows[0],
        logs: logsResult.rows,
      });
    } catch (error) {
      logError(req, 'Error API campana', error);
      res.status(500).json({ error: 'Error al cargar la campana' });
    }
  });
}

module.exports = { registerCampaigns };
